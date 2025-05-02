# CodingBaby-Browser-MCP

This is a Model Context Protocol (MCP) tool server designed to communicate with a Chrome browser extension via WebSocket for browser automation control.

## Description

This server starts a WebSocket server and waits for a connection from the companion Chrome extension. Once connected, an MCP client can send commands through this server to the Chrome extension to control browser behavior, such as navigation, clicking, typing, scrolling, taking screenshots, etc.

## Companion Chrome Extensio

This server requires a companion Chrome extension to perform the actual browser operations. Please ensure the extension is installed and enabled in your Chrome browser.

## Available Tools (Registered in `chrome-server.js`)

*   `navigate`: Navigates to a specified URL.
*   `click`: Performs a click operation at the specified coordinates (x,y) on the web page.
*   `type`: Types text into the currently focused element.
*   `press_key`: Simulates pressing a specific key on the keyboard (e.g., 'Enter', 'ArrowLeft').
*   `snapshot`: Captures a screenshot of the current page (returns Base64 encoded image data).
*   `close`: Closes the browser (or the tab controlled by the extension).
*   `scroll`: Scrolls the page in a specified direction (up, down, left, right), optionally with a selector for the element to scroll.
*   `save_html`: Saves the full HTML content of the current page to a temporary file on the server.
*   `set_viewport`: Sets the size (width and height) of the browser viewport.
*   `area_screenshot`: Take a screenshot of a specific area of the current page.
*   `get_saved_screenshots`: Get a list of all saved screenshots.
*   `wait`: Wait for a specified number of seconds and automatically returns a screenshot of the current page state after waiting.

## Installation

If using the source code directly, navigate to the `mcp/CodingBaby-Browser-MCP` directory and run:

```bash
npm install
```

If using the published npm package:

```bash
npm install @sydneyassistent/codingbaby-browser-mcp
```
or globally:
```bash
npm install -g @sydneyassistent/codingbaby-browser-mcp
```

## Running (from source)

```bash
node chrome-server.js
```

Or, using the script in `package.json`:

```bash
npm start
```

The server will start the WebSocket service on the default port `9876` and communicate with the MCP client via standard input/output (stdio).

## Running (as installed package with npx)

If installed locally or globally, you can often run it using `npx`:
```bash
npx @sydneyassistent/codingbaby-browser-mcp
```
(This requires the package to be configured correctly, potentially using a `bin` entry in `package.json` pointing to `chrome-server.js` for direct execution, which might need adjustment.)

## Notes

*   On the first call to any browser operation tool, the server will automatically attempt to start the WebSocket server and wait for the Chrome extension to connect.
*   Screenshots and HTML content are returned as part of the response or saved locally on the server.

## I. Introduction to CodingBaby Browser-Use MCP Principles

### 1.1 Overview

CodingBaby Browser-Use MCP (Model Context Protocol) is a tool that bridges an AI assistant with the Chrome browser, enabling the AI assistant to directly control Chrome for web browsing, interaction, and data collection. It communicates with a Chrome extension via the WebSocket protocol to achieve precise browser control.

### 1.2 Core Principles

The operation of CodingBaby Browser-Use MCP is based on several key components:

1.  **MCP Server**: A Node.js-based server providing standardized MCP interfaces, allowing the AI assistant to invoke browser control functions.
2.  **WebSocket Communication**: Uses the WebSocket protocol to establish a bi-directional real-time communication channel between the MCP server and the Chrome extension.
3.  **Chrome Extension**: An extension installed in the Chrome browser that receives commands from the MCP server and executes browser operations.
4.  **Command Translation**: Converts high-level commands from the AI assistant into low-level browser operations understandable by the Chrome extension.

The overall flow is as follows:

```
AI Assistant → MCP Server → WebSocket → Chrome Extension → Browser Operation → Web Page
```

### 1.3 Advantages

Compared to traditional browser automation tools like Puppeteer or Playwright, CodingBaby Browser-Use MCP offers several advantages:

*   **Higher Privileges**: Running as a Chrome extension provides higher browser privileges.
*   **Anti-Bot Evasion**: Uses a real Chrome browser and user session, effectively bypassing many website anti-bot mechanisms.
*   **Closer to Real User Behavior**: Operations mimic real user interactions, reducing the likelihood of detection.
*   **Session Persistence**: Can maintain login states and cookies, facilitating access to authenticated pages.
*   **Lightweight Deployment**: Only requires installing the extension in the browser, eliminating the need for separate browser instances or WebDrivers.

## II. CodingBaby Browser-Use MCP Functionality

### 2.1 Main Functions

CodingBaby Browser-Use MCP provides the following core functionalities:

1.  **Web Navigation** (`navigate`): Open URLs, go back/forward, etc.
2.  **Element Clicking** (`click`): Click elements on the page via coordinates.
3.  **Text Input** (`type`): Input text into forms, input fields, etc.
4.  **Key Pressing** (`press_key`): Simulate keyboard actions.
5.  **Page Scrolling** (`scroll`): Scroll page content up, down, left, or right.
6.  **Screenshot Capture** (`snapshot`, `take_screenshot`): Get screenshots of the current page.
7.  **HTML Saving** (`save_html`): Save the current page's HTML content.
8.  **Browser Closing** (`close`): Close the current browser session/tab.

### 2.2 Technical Implementation

The core of CodingBaby Browser-Use MCP's implementation lies in the WebSocket communication mechanism:

*   **Port Listening**: The server starts a WebSocket server on port 9876, awaiting connection from the Chrome extension.
*   **Message Format**: Uses JSON format for communication, including command type, parameters, and request ID.
*   **Asynchronous Responses**: Each request has a unique ID to ensure correct matching of requests and responses.
*   **Error Handling**: Includes timeout and error handling mechanisms for communication stability.
*   **Session Management**: Capable of managing multiple browser tab sessions (depending on extension implementation).


## III. Installation and Configuration

### 3.1 Prerequisites

*   Node.js 16+
*   Chrome Browser
*   The companion Chrome Extension (Chrome MCP Extension) installed and enabled.

### 3.2 Setup Steps

1.  Set up CodingBaby Browser-Use MCP (if running from source):
    ```bash
    # Install dependencies
    npm install

    # Start the server
    node chrome-server.js 
    ```
    Or install the package: `npm install @sydneyassistent/codingbaby-browser-mcp`

2.  Register MCP tools in your environment (e.g., Cursor):

    Edit `.cursor/mcp.json` to add/update the server configuration:

    ```json
    {
      "mcpServers": {
        "chrome-server": {
          "command": "npx", 
          "args": ["@sydneyassistent/codingbaby-browser-mcp"] 
        }
        // ... other servers ...
      }
    }
    ```

Remember to restart your MCP environment after changing configurations. 