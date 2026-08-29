#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(test))]
fn main() {
    local_material_workbench_lib::run();
}

#[cfg(test)]
fn main() {}
