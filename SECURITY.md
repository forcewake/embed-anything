# Security

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or contact the maintainers directly.

Include a description, the affected version or commit, and a reproduction if
you have one. You can expect an acknowledgement within a few days.

## What this project does with your data

**Nothing leaves your device.** The application is a fully client-side demo:

- the model, the corpus and the media are downloaded over HTTPS from public
  CDNs;
- the **query** — text, an image, an audio clip or a video — is embedded in a
  Web Worker in your browser and is never sent anywhere;
- there is no analytics, no telemetry, no tracker, no cookie and no hosted
  inference API;
- the microphone and the camera are only opened after an explicit user action,
  and the media tracks are stopped as soon as the capture ends.

The only outbound requests the page makes are for the assets it needs to
render: the Unsplash / Pexels / Wikimedia / Pixabay media, the Hugging Face
model weights and the local ONNX Runtime sidecar.

## Notes for operators

- The app must be served over **HTTPS or localhost**: the camera and the
  microphone require a secure context.
- The dev and preview servers send `Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: credentialless`, which is what the
  threaded ONNX Runtime WASM build needs. Keep those headers in production.
- The model is executed on the GPU through WebGPU. A hostile page cannot reach
  it — the worker is same-origin and no message from the page can make it load
  a different model or a different index.
