//! Image response normalization for local and cloud adapters.

#[derive(Clone, Copy)]
pub(super) enum ImageResponseFormat {
    SdApi,
    OpenAiCompatible,
}

pub(super) fn parse_generated_images(
    body: &serde_json::Value,
    response_format: ImageResponseFormat,
) -> Vec<String> {
    match response_format {
        ImageResponseFormat::SdApi => parse_sdcpp_generated_images(body),
        ImageResponseFormat::OpenAiCompatible => body
            .get("data")
            .and_then(|value| value.as_array())
            .into_iter()
            .flat_map(|items| items.iter())
            .filter_map(|item| {
                item.get("b64_json")
                    .and_then(|value| value.as_str())
                    .map(|b64| format!("data:image/png;base64,{b64}"))
                    .or_else(|| {
                        item.get("url")
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                    })
            })
            .collect(),
    }
}

pub(super) fn parse_sdcpp_generated_images(body: &serde_json::Value) -> Vec<String> {
    let output_format = body
        .get("result")
        .and_then(|value| value.get("output_format"))
        .or_else(|| body.get("output_format"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("png");

    parse_image_items(body.get("images"), output_format)
        .into_iter()
        .chain(parse_image_items(
            body.get("result").and_then(|value| value.get("images")),
            output_format,
        ))
        .chain(
            body.get("result")
                .and_then(|value| value.get("b64_json"))
                .and_then(serde_json::Value::as_str)
                .map(|b64| data_url_from_b64(output_format, b64)),
        )
        .collect()
}

fn parse_image_items(value: Option<&serde_json::Value>, output_format: &str) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|item| {
            item.as_str()
                .map(|b64| data_url_from_b64(output_format, b64))
                .or_else(|| {
                    item.get("b64_json")
                        .and_then(serde_json::Value::as_str)
                        .map(|b64| data_url_from_b64(output_format, b64))
                })
                .or_else(|| {
                    item.get("url")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
        })
        .collect()
}

fn data_url_from_b64(output_format: &str, b64: &str) -> String {
    let format = output_format
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    let mime = match format.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    format!("data:{mime};base64,{b64}")
}

pub(super) fn summarize_image_response_shape(body: &serde_json::Value) -> String {
    let Some(object) = body.as_object() else {
        return body
            .as_str()
            .map_or_else(|| body.to_string(), std::string::ToString::to_string);
    };

    object
        .iter()
        .map(|(key, value)| {
            let kind = if value.is_array() {
                "array"
            } else if value.is_object() {
                "object"
            } else if value.is_string() {
                "string"
            } else if value.is_number() {
                "number"
            } else if value.is_boolean() {
                "boolean"
            } else {
                "null"
            };
            format!("{key}:{kind}")
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn parse_cloud_generated_images(body: &serde_json::Value) -> Vec<String> {
    body.get("choices")
        .and_then(|value| value.as_array())
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|item| item.get("message"))
        .flat_map(extract_images_from_cloud_message)
        .collect()
}

fn extract_images_from_cloud_message(message: &serde_json::Value) -> Vec<String> {
    if let Some(images) = message.get("images").and_then(|value| value.as_array()) {
        return images.iter().filter_map(extract_cloud_image_url).collect();
    }

    if let Some(content) = message.get("content").and_then(|value| value.as_array()) {
        return content
            .iter()
            .filter_map(|item| {
                item.get("image_url")
                    .and_then(|value| value.get("url"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .collect();
    }

    Vec::new()
}

fn extract_cloud_image_url(item: &serde_json::Value) -> Option<String> {
    item.get("image_url")
        .and_then(|value| value.get("url"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            item.get("imageUrl")
                .and_then(|value| value.get("url"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
}

#[cfg(test)]
mod tests {
    use super::{ImageResponseFormat, parse_generated_images};
    use serde_json::json;

    #[test]
    fn parses_stable_diffusion_webui_style_images() {
        let images = parse_generated_images(
            &json!({
                "images": ["ZmFrZQ=="],
                "parameters": {},
                "info": "{}"
            }),
            ImageResponseFormat::SdApi,
        );

        assert_eq!(images, vec!["data:image/png;base64,ZmFrZQ=="]);
    }

    #[test]
    fn parses_sdcpp_webui_result_images() {
        let images = parse_generated_images(
            &json!({
                "kind": "img_gen",
                "result": {
                    "output_format": "webp",
                    "images": [
                        { "b64_json": "ZmFrZQ==" }
                    ]
                }
            }),
            ImageResponseFormat::SdApi,
        );

        assert_eq!(images, vec!["data:image/webp;base64,ZmFrZQ=="]);
    }
}
