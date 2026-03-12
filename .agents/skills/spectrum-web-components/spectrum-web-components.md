---
name: spectrum-web-components
description: Enables the agent to correctly code using the spectrum web components framework.
---

# Spectrum Web Components

The directory .agents/skills/spectrum-web-components/docs contains a list of all available components. Each md file contains documentation of how to use it.

## When to Use

- Always when coding with spectrum web components.

## Instructions

- Check which components are available
- Select components that are useful for the current task
- Read the docs of the component to use it correctly
- When adding a new component not previously used in the project, add it to /deps/swc.js and install it using npm
- After adding the component, run npm run build:swc. The built actifact is already being imported automatically, no change required.