use std::{fs::File, io::Read, path::Path};

pub(crate) fn has_supported_container(
    path: &Path,
    extension: &str,
) -> Result<bool, std::io::Error> {
    let mut file = File::open(path)?;
    let mut magic = [0_u8; 4];
    let length = file.read(&mut magic)?;
    if extension == "xls" {
        return Ok(length == 4 && magic == [0xd0, 0xcf, 0x11, 0xe0]);
    }
    Ok(length == 4 && magic == [0x50, 0x4b, 0x03, 0x04])
}
