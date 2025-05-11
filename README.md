# CodingBaby-Browser-MCP

## Overview

CodingBaby-Browser-MCP is a powerful tool that enables AI assistants like Claude 3.7 Sonnet in Cursor to control Chrome browser for automated tasks. This tool bridges the gap between AI and web browser interaction through a WebSocket-based communication protocol.

## Features

- **Browser Automation**: Control Chrome browser programmatically to navigate websites, fill forms, and perform clicks
- **Screenshot Capture**: Take screenshots of entire pages or specific areas
- **Multi-tab Support**: Create, list, select, and close browser tabs
- **Form Interaction**: Type text, press keys, and select form elements
- **Batch Commands**: Execute multiple browser operations in sequence
- **Viewport Control**: Adjust browser window size for responsive testing

## Architecture

The project consists of two main components:

1. **MCP Tool Server**: A Node.js server that implements the Model Context Protocol (MCP) to communicate with AI assistants in Cursor
2. **Chrome Extension**: A browser extension that receives commands from the MCP server and controls the browser

The system uses WebSocket (port 9876 by default) to establish a bidirectional communication channel between the MCP server and the Chrome extension.

## Installation

### Prerequisites
- Node.js (v14 or higher)
- Chrome browser
- Cursor editor with Claude 3.7 Sonnet

### MCP Tool Setup
1. In Cursor, go to Settings → MCP
2. Add new global MCP server with the following configuration:
```json
{
  "mcpServers": {
    "CodingBaby-Browser-MCP": {
      "command": "npx",
      "args": ["@sydneyassistent/codingbaby-browser-mcp"]
    }
  }
}
```

### Chrome Extension Setup
1. Install the CodingBaby Extension from the Chrome Web Store
2. Enable the extension and ensure it has the necessary permissions

## Usage

Once installed, you can ask Claude 3.7 in Cursor to control your browser:

```
Use the browser to navigate to https://example.com
```

## Available Commands

- `navigate`: Open a URL in the browser
- `click`: Click on elements
- `type`: Enter text in form fields
- `pressKey`: Simulate keyboard actions
- `scroll`: Scroll in any direction
- `takeScreenshot`: Capture browser content
- `wait`: Pause execution for specified time
- `setViewport`: Change browser window dimensions
- `tabNew`, `tabList`, `tabSelect`, `tabClose`: Tab management
- `batch`: Execute multiple commands in sequence
- `close`: Close the browser session

## Development and Debugging

If you've downloaded the source code, you can set up the project for development and debugging purposes.

### Debugging Chrome Extension

To load and debug the Chrome extension from source code:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" by toggling the switch in the top-right corner
3. Click "Load unpacked" button
4. Navigate to the `chrome-extension` directory in the project and select it
5. The extension will now be loaded in developer mode
6. You can view console logs by right-clicking the extension icon, selecting "Inspect" and opening the Console tab
7. Make changes to the extension code and click the refresh icon on the extension card to apply changes

### Debugging MCP Server in Cursor

To use the local MCP server code for debugging:

1. Clone or download the repository to your local machine
2. Navigate to the project directory and install dependencies:
   ```bash
   cd Browser-MCP
   npm install
   ```
3. In Cursor, go to Settings → MCP
4. Add a new MCP server with the following configuration:
   ```json
   {
     "mcpServers": {
       "CodingBaby-Browser-MCP-Dev": {
         "command": "node",
         "args": ["/absolute/path/to/your/Browser-MCP/index.js"]
       }
     }
   }
   ```
   Replace `/absolute/path/to/your/` with the actual path to the downloaded project
5. Click "Refresh" to load the MCP server
6. You can now make changes to the MCP server code and restart the server by clicking "Refresh" in Cursor's MCP settings

For debugging, you can:
- Check the Cursor MCP logs by clicking on the MCP status icon
- Add `console.error()` statements to the code for more detailed logging
- Run the MCP server manually from the terminal for full console output

## Troubleshooting

- **Port Conflict**: If port 9876 is already in use, the tool will attempt to release it automatically
- **Connection Issues**: Ensure the Chrome extension is properly installed and enabled

## License

MIT

## Links

- Official Website: [www.codingbaby.fun](https://www.codingbaby.fun)
- NPM Package: [@sydneyassistent/codingbaby-browser-mcp](https://www.npmjs.com/package/@sydneyassistent/codingbaby-browser-mcp)
- Chrome Extension: [CodingBaby Extension](https://chromewebstore.google.com/detail/codingbaby-extension/pjadpjgapfnmaaabkjbeldmjdmcfgcco) 