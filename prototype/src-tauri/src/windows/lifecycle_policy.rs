#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowCloseAction {
    HideToTray,
    Exit,
}

pub(crate) fn main_window_close_action(hide_to_tray: bool) -> MainWindowCloseAction {
    if hide_to_tray {
        MainWindowCloseAction::HideToTray
    } else {
        MainWindowCloseAction::Exit
    }
}

#[cfg(test)]
mod tests {
    use super::{main_window_close_action, MainWindowCloseAction};

    #[test]
    fn unchecked_hide_to_tray_exits_the_whole_application() {
        assert_eq!(main_window_close_action(false), MainWindowCloseAction::Exit);
    }

    #[test]
    fn checked_hide_to_tray_keeps_the_application_in_the_tray() {
        assert_eq!(
            main_window_close_action(true),
            MainWindowCloseAction::HideToTray
        );
    }
}
