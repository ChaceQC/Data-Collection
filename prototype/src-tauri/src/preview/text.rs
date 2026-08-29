use encoding_rs::GB18030;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DecodedText {
    pub value: String,
    pub encoding: &'static str,
}

pub(crate) fn decode(bytes: &[u8]) -> Result<DecodedText, ()> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        let value = std::str::from_utf8(&bytes[3..]).map_err(|_| ())?;
        return Ok(DecodedText {
            value: value.to_string(),
            encoding: "utf-8-bom",
        });
    }

    if let Ok(value) = std::str::from_utf8(bytes) {
        return Ok(DecodedText {
            value: value.to_string(),
            encoding: "utf-8",
        });
    }

    let (value, _, had_errors) = GB18030.decode(bytes);
    if had_errors {
        return Err(());
    }
    Ok(DecodedText {
        value: value.into_owned(),
        encoding: "gb18030",
    })
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn identifies_utf8_variants_and_gb18030() {
        assert_eq!(decode("标题".as_bytes()).unwrap().encoding, "utf-8");
        assert_eq!(
            decode(&[0xef, 0xbb, 0xbf, b'#', b' ', 0xe7, 0xa0, 0x94, 0xe7, 0xa9, 0xb6])
                .unwrap()
                .encoding,
            "utf-8-bom"
        );
        let (encoded, _, _) = encoding_rs::GB18030.encode("中文");
        assert_eq!(decode(&encoded).unwrap().encoding, "gb18030");
    }

    #[test]
    fn rejects_invalid_utf8_and_gb18030() {
        assert!(decode(&[0xff, 0xfe, 0xfd]).is_err());
    }
}
