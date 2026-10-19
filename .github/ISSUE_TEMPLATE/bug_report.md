name: Bug report
description: Something in the recreation does not behave like the reference
labels: ['bug']
body:

- type: markdown
  attributes:
  value: |
  Thanks for the report. If the recreation behaves **differently from the
  reference Space**, that is the most useful kind of report — please say
  which one and what the reference does instead.
- type: textarea
  id: what-happened
  attributes:
  label: What happened
  description: What did you observe, and what did you expect?
  validations:
  required: true
- type: textarea
  id: reproduce
  attributes:
  label: Steps to reproduce
  placeholder: | 1. Run `npm run dev` 2. Open http://localhost:5173/?seed=42 3. …
  validations:
  required: true
- type: textarea
  id: logs
  attributes:
  label: Console output
  description: The browser console, or the output of the failing command.
  render: shell
- type: input
  id: browser
  attributes:
  label: Browser
  placeholder: 'Chrome 141 on macOS 15'
  validations:
  required: true
- type: checkboxes
  id: capabilities
  attributes:
  label: Capabilities
  options: - label: WebGL2 is available - label: WebGPU is available - label: The model finished loading ("Embedding Gemma 2 ready")
- type: input
  id: version
  attributes:
  label: Commit
  description: The output of `git rev-parse --short HEAD`.
