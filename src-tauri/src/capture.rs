//! Copies the current selection in whatever app is in front by sending the system copy
//! keystroke, so one shortcut both copies and saves.

/// Why the copy keystroke couldn't be sent.
pub enum CopyError {
    /// macOS only lets apps send keystrokes once they're allowed under Accessibility.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NeedsPermission,
    Failed,
}

/// Sends Cmd+C (macOS) or Ctrl+C (Windows) to the frontmost app.
pub fn send_copy() -> Result<(), CopyError> {
    platform::send_copy()
}

/// Opens the system prompt asking the user to allow Perch under Accessibility (macOS only).
pub fn request_permission() {
    platform::request_permission();
}

#[cfg(target_os = "macos")]
mod platform {
    use super::CopyError;
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEY_C: u16 = 8; // kVK_ANSI_C

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    pub fn send_copy() -> Result<(), CopyError> {
        if !unsafe { AXIsProcessTrusted() } {
            return Err(CopyError::NeedsPermission);
        }
        // A private source keeps the user's still-held ⌘⌃ from leaking into the event.
        let source = CGEventSource::new(CGEventSourceStateID::Private).map_err(|_| CopyError::Failed)?;
        for down in [true, false] {
            let event = CGEvent::new_keyboard_event(source.clone(), KEY_C, down).map_err(|_| CopyError::Failed)?;
            event.set_flags(CGEventFlags::CGEventFlagCommand);
            event.post(CGEventTapLocation::HID);
        }
        Ok(())
    }

    pub fn request_permission() {
        let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
        let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
    }
}

#[cfg(windows)]
mod platform {
    use super::CopyError;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput, VIRTUAL_KEY, VK_C,
        VK_CONTROL, VK_MENU,
    };

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    pub fn send_copy() -> Result<(), CopyError> {
        // The shortcut's Alt may still be held, which would turn this into Ctrl+Alt+C.
        let inputs = [
            key(VK_MENU, true),
            key(VK_CONTROL, false),
            key(VK_C, false),
            key(VK_C, true),
            key(VK_CONTROL, true),
        ];
        let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
        if sent == inputs.len() as u32 { Ok(()) } else { Err(CopyError::Failed) }
    }

    pub fn request_permission() {}
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::CopyError;

    pub fn send_copy() -> Result<(), CopyError> {
        Err(CopyError::Failed)
    }

    pub fn request_permission() {}
}
