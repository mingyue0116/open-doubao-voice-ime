//! Windows IME Named Pipe IPC - Raw Win32 FFI
//! Sends text through named pipe to registered TSF IME

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImeSubmitRequest {
    pub session_id: String,
    pub text: String,
    pub created_at: String,
    pub target: Option<ImeSubmitTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImeSubmitTarget {
    pub process_id: u32,
    pub thread_id: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImeSubmitStatus {
    Committed,
    Rejected,
    Failed,
}

#[derive(Debug, thiserror::Error)]
pub enum WindowsImeIpcError {
    #[error("IME not available")]
    Unavailable,
    #[error("IO: {0}")]
    Io(String),
}

pub struct WindowsImeIpcServer;

impl WindowsImeIpcServer {
    pub fn new() -> Self { Self }

    /// Submit text via named pipe to the IME DLL
    pub fn submit_text(&self, request: &ImeSubmitRequest) -> Result<ImeSubmitStatus, WindowsImeIpcError> {
        #[cfg(windows)] { submit_text_windows(request) }
        #[cfg(not(windows))] { let _ = request; Err(WindowsImeIpcError::Unavailable) }
    }
}

#[cfg(windows)]
fn submit_text_windows(request: &ImeSubmitRequest) -> Result<ImeSubmitStatus, WindowsImeIpcError> {
    let pid = std::process::id();
    
    // Build the JSON message
    let msg = serde_json::json!({
        "type": "submitText",
        "protocolVersion": 1,
        "sessionId": request.session_id,
        "text": request.text,
        "createdAt": request.created_at,
    });
    let msg_str = serde_json::to_string(&msg)
        .map_err(|e| WindowsImeIpcError::Io(e.to_string()))?;
    
    // Try to connect to named pipe candidates
    let candidates = [
        format!(r"\\.\pipe\OpenLessImeSubmit-{pid}-0"),
        format!(r"\\.\pipe\OpenLessImeSubmit-{pid}-1"),
        format!(r"\\.\pipe\OpenLessImeSubmit-{pid}-2"),
        format!(r"\\.\pipe\OpenLessImeSubmit-{pid}"),
    ];
    
    for pipe_name in &candidates {
        if let Ok(result) = try_send_pipe(pipe_name, &msg_str) {
            return Ok(result);
        }
    }
    
    Err(WindowsImeIpcError::Unavailable)
}

#[cfg(windows)]
fn try_send_pipe(pipe_name: &str, message: &str) -> Result<ImeSubmitStatus, WindowsImeIpcError> {
    // Use CallNamedPipeW which opens, writes, reads, and closes in one call
    // FFI declaration:
    // BOOL WINAPI CallNamedPipeW(
    //   LPCWSTR lpNamedPipeName,
    //   LPVOID lpInBuffer, DWORD nInBufferSize,
    //   LPVOID lpOutBuffer, DWORD nOutBufferSize,
    //   LPDWORD lpBytesRead, DWORD nTimeOut
    // );
    
    type CallNamedPipeW = unsafe extern "system" fn(
        *const u16, *const u8, u32, *mut u8, u32, *mut u32, u32,
    ) -> i32;
    
    let kernel32 = unsafe { LoadLibraryW("kernel32.dll\0".encode_utf16().collect::<Vec<_>>().as_ptr()) };
    if kernel32.is_null() { return Err(WindowsImeIpcError::Unavailable); }
    
    let func = unsafe {
        let name = "CallNamedPipeW\0".encode_utf16().collect::<Vec<_>>();
        let ptr = GetProcAddress(kernel32, name.as_ptr() as *const i8);
        if ptr.is_null() { FreeLibrary(kernel32); return Err(WindowsImeIpcError::Unavailable); }
        std::mem::transmute::<_, CallNamedPipeW>(ptr)
    };
    
    let wide_name: Vec<u16> = pipe_name.encode_utf16().chain(std::iter::once(0)).collect();
    let in_bytes = message.as_bytes();
    let mut out_buf = [0u8; 4096];
    let mut bytes_read: u32 = 0;
    
    let result = unsafe {
        func(
            wide_name.as_ptr(),
            in_bytes.as_ptr(),
            in_bytes.len() as u32,
            out_buf.as_mut_ptr(),
            out_buf.len() as u32,
            &mut bytes_read,
            5000, // 5 second timeout
        )
    };
    
    unsafe { FreeLibrary(kernel32); }
    
    if result == 0 {
        return Err(WindowsImeIpcError::Unavailable);
    }
    
    if bytes_read > 0 {
        let response = String::from_utf8_lossy(&out_buf[..bytes_read as usize]);
        if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&response) {
            let status = resp.get("status").and_then(|v| v.as_str()).unwrap_or("failed");
            match status {
                "committed" => return Ok(ImeSubmitStatus::Committed),
                "rejected" => return Ok(ImeSubmitStatus::Rejected),
                _ => return Ok(ImeSubmitStatus::Failed),
            }
        }
    }
    
    Ok(ImeSubmitStatus::Failed)
}

#[cfg(windows)]
extern "system" {
    fn LoadLibraryW(lpFileName: *const u16) -> *mut ();
    fn GetProcAddress(hModule: *mut (), lpProcName: *const i8) -> *mut ();
    fn FreeLibrary(hModule: *mut ()) -> i32;
}
