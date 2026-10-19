name: Feature request
description: Suggest an addition to the recreation
labels: ['enhancement']
body:

- type: textarea
  id: problem
  attributes:
  label: The problem
  description: What are you trying to do that is not possible today?
  validations:
  required: true
- type: textarea
  id: proposal
  attributes:
  label: The proposal
  description: What would you like to happen?
  validations:
  required: true
- type: textarea
  id: fidelity
  attributes:
  label: Fidelity impact
  description: |
  Does this change what the initial mosaic or the search does?

      The initial mosaic is a **shuffled, aspect-ratio aware row layout** and
      the search is an **exact cosine retrieval**. A proposal that turns
      either into something else needs to be additive — a new mode, a new
      view — so the original experience stays intact.

  render: markdown

- type: checkboxes
  id: constraints
  attributes:
  label: Constraints
  options: - label: It works without WebGPU (the mosaic stays browsable) - label: It works without the model being loaded - label: It does not change the initial composition
