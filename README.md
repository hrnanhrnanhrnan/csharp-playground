## C# Playground

C# Playground is a Visual Studio Code extension designed for developers to quickly experiment with C# code in an isolated environment. Get immediate feedback with inline runtime values for variables and everything written to the console – all displayed directly within your editor.

With a single command, you can spin up a dedicated playground environment. The playground automatically runs on save, offering real-time insights by displaying inline values for all global variables and console outputs. Perfect for quick testing, exploring new APIs, or learning C# in an interactive, hassle-free setup.

## Features

- One-Command Playground Setup: Start a new playground environment with a single command, "New Playground." This will open a temporary project workspace in a new window where you can write and test C# code in isolation. When you're done just close the window or run the "Stop playground" command. To continue where you previously left off, just run the "Continue Playground" command to open up the workspace again.

- Inline Runtime Feedback: On each save, C# Playground displays inline runtime values for all global variables and everything printed to the console, directly at the end of each relevant line. This saves you time and allows for immediate feedback without switching contexts.

- Quick Experimentation: Ideal for prototyping, testing ideas, or learning – without affecting your main projects or workspace setup.

![](/images/playground.gif)

## Installation

To install C# Playground:

1. Open Visual Studio Code.
2. Go to the Extensions Marketplace and search for "C# Playground."
3. Click "Install" to add it to your extensions.

Once installed, you’re ready to start coding in the playground!

## Extension Settings

You can configure the following settings to customize your C# Playground experience:

* `csharp-playground.dotnetVersion`: Define the version of .NET to use when initializing a new playground. For example, specify `8` to use `.NET 8 (net8)`. If left unspecified or set to an invalid version, the playground defaults to the latest installed .NET version on your system.

## Known Issues

- Tuple deconstruction seems not to be allowed at the top level in Roslyn scripting. The scripting environment imposes certain restrictions on the syntax that can be used at the top level of a script 

- Currently, C# Playground operates in a separate window from your main workspace. While initially intended to integrate into the active workspace, doing so led to issues with Omnisharp. Adding the playground to the current workspace caused Omnisharp to activate on the newly added project and consequently lose LSP (Language Server Protocol) functionality for any previously open projects. This appears to be a limitation with Omnisharp’s multi-root project support.


## Release Notes

1.0.0

Initial release with full playground functionality.
Inline runtime values for global variables and console outputs.
"New Playground" command for rapid setup.