# CodingBaby Browser MCP
[![smithery badge](https://smithery.ai/badge/@buyitsydney/codingbaby-browser-mcp)](https://smithery.ai/server/@buyitsydney/codingbaby-browser-mcp)

This is a Model Context Protocol (MCP) tool server designed to communicate with a Chrome browser extension via WebSocket for browser automation control.

## Description

This server starts a WebSocket server and waits for a connection from the companion Chrome extension. Once connected, an MCP client can send commands through this server to the Chrome extension to control browser behavior, such as navigation, clicking, typing, scrolling, taking screenshots, etc.

## Companion Chrome Extension

This server requires a companion Chrome extension to perform the actual browser operations. Please ensure the extension is installed and enabled in your Chrome browser.

## Available Tools (Registered in `chrome-server.js`)

*   `navigate`: Navigates to a specified URL.
*   `click`: Performs a click operation at the specified coordinates (x,y) on the web page.
*   `type`: Types text into the currently focused element.
*   `press_key`: Simulates pressing a specific key on the keyboard (e.g., 'Enter', 'ArrowLeft').
*   `snapshot`: Captures a screenshot of the current page (returns Base64 encoded image data).
*   `close`: Closes the browser (or the tab controlled by the extension).
*   `scroll`: Scrolls the page in a specified direction (up, down, left, right), optionally with a selector for the element to scroll.
*   `take_screenshot`: Takes a screenshot of the current page (similar to snapshot, specific implementation differences should be verified).
*   `save_html`: Saves the full HTML content of the current page to a temporary file on the server.
*   `set_viewport`: Sets the size (width and height) of the browser viewport.

## Installation

### Installing via Smithery

To install Chrome Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@buyitsydney/codingbaby-browser-mcp):

```bash
npx -y @smithery/cli install @buyitsydney/codingbaby-browser-mcp --client claude
```

If using the source code directly, navigate to the `mcp/chrome-server` directory and run:

```bash
npm install
```

If using the published npm package:

```bash
npm install @sydneyassistent/chrome-server
```
or globally:
```bash
npm install -g @sydneyassistent/chrome-server
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
npx @sydneyassistent/chrome-server
```
(This requires the package to be configured correctly, potentially using a `bin` entry in `package.json` pointing to `chrome-server.js` for direct execution, which might need adjustment.)

## Notes

*   On the first call to any browser operation tool, the server will automatically attempt to start the WebSocket server and wait for the Chrome extension to connect.
*   Screenshots and HTML content are returned as part of the response or saved locally on the server.

## I. Introduction to Chrome Server MCP Principles

### 1.1 Overview

Chrome Server MCP (Model Context Protocol) is a tool that bridges an AI assistant with the Chrome browser, enabling the AI assistant to directly control Chrome for web browsing, interaction, and data collection. It communicates with a Chrome extension via the WebSocket protocol to achieve precise browser control.

### 1.2 Core Principles

The operation of Chrome Server MCP is based on several key components:

1.  **MCP Server**: A Node.js-based server providing standardized MCP interfaces, allowing the AI assistant to invoke browser control functions.
2.  **WebSocket Communication**: Uses the WebSocket protocol to establish a bi-directional real-time communication channel between the MCP server and the Chrome extension.
3.  **Chrome Extension**: An extension installed in the Chrome browser that receives commands from the MCP server and executes browser operations.
4.  **Command Translation**: Converts high-level commands from the AI assistant into low-level browser operations understandable by the Chrome extension.

The overall flow is as follows:

```
AI Assistant → MCP Server → WebSocket → Chrome Extension → Browser Operation → Web Page
```

### 1.3 Advantages

Compared to traditional browser automation tools like Puppeteer or Playwright, Chrome Server MCP offers several advantages:

*   **Higher Privileges**: Running as a Chrome extension provides higher browser privileges.
*   **Anti-Bot Evasion**: Uses a real Chrome browser and user session, effectively bypassing many website anti-bot mechanisms.
*   **Closer to Real User Behavior**: Operations mimic real user interactions, reducing the likelihood of detection.
*   **Session Persistence**: Can maintain login states and cookies, facilitating access to authenticated pages.
*   **Lightweight Deployment**: Only requires installing the extension in the browser, eliminating the need for separate browser instances or WebDrivers.

## II. Chrome Server MCP Functionality

### 2.1 Main Functions

Chrome Server MCP provides the following core functionalities:

1.  **Web Navigation** (`navigate`): Open URLs, go back/forward, etc.
2.  **Element Clicking** (`click`): Click elements on the page via coordinates.
3.  **Text Input** (`type`): Input text into forms, input fields, etc.
4.  **Key Pressing** (`press_key`): Simulate keyboard actions.
5.  **Page Scrolling** (`scroll`): Scroll page content up, down, left, or right.
6.  **Screenshot Capture** (`snapshot`, `take_screenshot`): Get screenshots of the current page.
7.  **HTML Saving** (`save_html`): Save the current page's HTML content.
8.  **Browser Closing** (`close`): Close the current browser session/tab.

### 2.2 Technical Implementation

The core of Chrome Server MCP's implementation lies in the WebSocket communication mechanism:

*   **Port Listening**: The server starts a WebSocket server on port 9876, awaiting connection from the Chrome extension.
*   **Message Format**: Uses JSON format for communication, including command type, parameters, and request ID.
*   **Asynchronous Responses**: Each request has a unique ID to ensure correct matching of requests and responses.
*   **Error Handling**: Includes timeout and error handling mechanisms for communication stability.
*   **Session Management**: Capable of managing multiple browser tab sessions (depending on extension implementation).

## III. Introduction to DOM Analyzer MCP

DOM Analyzer MCP is a tool specifically designed for web page DOM analysis, enabling precise extraction and analysis of web structure and content.

### 3.1 DOM Analyzer Core Functions

1.  **Search by Text** (`search_by_text`): Find elements containing specific text.
2.  **Search by Selector** (`search_by_selector`): Find elements using CSS selectors.
3.  **Search by XPath** (`search_by_xpath`): Find elements using XPath expressions.
4.  **Search by Regex** (`search_by_regex`): Find text content matching a regular expression.
5.  **Analyze Page** (`analyze_page`): Automatically analyze page structure and extract key information.
6.  **Save HTML** (`save_html`): Save HTML content to a temporary file for subsequent analysis.

## IV. Using Chrome Server MCP and DOM Analyzer Together

### 4.1 Principle of Combined Use

Chrome Server MCP and DOM Analyzer MCP can work synergistically to form a powerful web interaction and analysis toolchain:

1.  Chrome Server handles browser control and page navigation.
2.  DOM Analyzer handles detailed analysis of page content and data extraction.

This combination leverages the respective strengths of both tools: Chrome Server's browsing capabilities and DOM Analyzer's analytical power.

### 4.2 Typical Workflow

```
Chrome Server MCP navigates to the target page → 
Save HTML to a temporary file → 
DOM Analyzer analyzes the HTML content → 
Based on the analysis, Chrome Server performs the next action
```

### 4.3 Example Steps

#### Step 1: Navigate to the Target Page

Use Chrome Server MCP's `navigate` tool:

```javascript
// Navigate to the target page
const navigateResult = await callTool("mcp_chrome-server_navigate", {
  url: "https://example.com/target-page"
});
```

#### Step 2: Save Page HTML

Use Chrome Server MCP's `save_html` tool:

```javascript
// Save page HTML to a temporary file
const saveHtmlResult = await callTool("mcp_chrome-server_save_html", {
  filename: "" // Empty filename saves to the default temporary path
});

// Get the path of the saved HTML file
const htmlPath = JSON.parse(saveHtmlResult.content[0].text).path; 
```

#### Step 3: Analyze Page with DOM Analyzer

Use DOM Analyzer functions to analyze the saved HTML:

```javascript
// Use text search to find specific content
const searchResult = await callTool("mcp_dom-analyzer_search_by_text", {
  query: "Target Content",
  htmlPath: htmlPath 
});

// Process the search results
const analysisData = JSON.parse(searchResult.logs); 
```

#### Step 4: Act Based on Analysis

Use Chrome Server to perform actions based on DOM Analyzer's findings:

```javascript
// Assuming we found the position of the target element
if (analysisData.elements && analysisData.elements.length > 0) {
  // Extract element position (example, actual calculation needed)
  const elementPosition = "100,200"; 
  
  // Click the position
  await callTool("mcp_chrome-server_click", {
    coordinate: elementPosition
  });
}
```

### 4.4 Advanced Use Cases

1.  **Intelligent Form Filling**: Identify form fields with DOM Analyzer, then fill them using Chrome Server.
2.  **Content Monitoring**: Periodically check web content changes and trigger notifications.
3.  **Multi-Step Process Automation**: Automate tasks like login, navigation, and data extraction.
4.  **Smart Crawling**: Create intelligent crawlers that understand page structure and navigate accordingly.
5.  **Data Extraction and Cleaning**: Precisely extract data using DOM Analyzer selectors and structure it.

## V. Installation and Configuration

### 5.1 Prerequisites

*   Node.js 16+
*   Chrome Browser
*   The companion Chrome Extension (Chrome MCP Extension) installed and enabled.

### 5.2 Setup Steps

1.  Set up Chrome Server MCP (if running from source):
    ```bash
    # Install dependencies
    cd mcp/chrome-server
    npm install

    # Start the server
    node chrome-server.js 
    ```
    Or install the package: `npm install @sydneyassistent/chrome-server`

2.  Set up DOM Analyzer (refer to its own documentation/setup).

3.  Register MCP tools in your environment (e.g., Cursor):

    Edit `.cursor/mcp.json` to add/update the server configuration:

    ```json
    {
      "mcpServers": {
        "chrome-server": {
          "command": "npx", 
          "args": ["@sydneyassistent/chrome-server"] 
        },
        "dom-analyzer": {
          // ... configuration for dom-analyzer ...
        }
        // ... other servers ...
      }
    }
    ```

Remember to restart your MCP environment after changing configurations. 