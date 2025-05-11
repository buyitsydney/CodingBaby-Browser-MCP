# CodingBaby-Browser-MCP

## What is CodingBaby-Browser-MCP?

CodingBaby-Browser-MCP is a powerful tool that allows AI agents like Claude 3.7 Sonnet in Cursor to control your Chrome browser for automated tasks. With this tool, your AI assistant can:

- Fill out web forms automatically
- Perform automated testing of websites
- Navigate through complex web applications
- Publish content to websites
- Take screenshots of web pages
- Extract data from websites
- Execute any browser-based workflow

**Official Website:** [www.codingbaby.fun](https://www.codingbaby.fun)

## Setup Guide

This tool requires two components to work properly:

1. **The MCP Tool Server** - Connects your AI assistant to your browser
2. **The Chrome Extension** - Allows the MCP tool to control your browser

### Step 1: Install the MCP Tool in Cursor

1. Open Cursor and click on **Settings**
2. Select **MCP**
3. Click **Add new global MCP server**
4. Add the following JSON configuration (be careful with commas if you have other MCP tools):

```json
{
  "mcpServers": {
    "CodingBaby-Browser-MCP": {
      "command": "npx",
      "args": ["@sydneyassistent/codingbaby-browser-mcp"]
    }
    // Your other MCP tools may be here
  }
}
```

### Step 2: Install the Chrome Extension

1. Visit the Chrome Web Store at: [CodingBaby Extension](https://chromewebstore.google.com/detail/codingbaby-extension/pjadpjgapfnmaaabkjbeldmjdmcfgcco)
2. Click "Add to Chrome"
3. Follow the prompts to complete installation

### Step 3: Select Claude 3.7 Sonnet in Cursor

For the best experience, make sure to use Claude 3.7 Sonnet as your AI model, as it provides superior instruction-following capabilities and visual interaction support.

### Step 4: Verify MCP Connection

1. Go to Cursor → Settings → MCP
2. Click the "Refresh" button to reload MCP tools
3. If the MCP status indicator turns green, your connection is working properly

## Troubleshooting

### MCP Shows Red Status
If the MCP status indicator is red in Cursor:
1. Click the "Refresh" button to restart the MCP connection
2. Wait a few seconds for the connection to re-establish

### Port 9876 Conflict
If you see an error about port 9876 being in use:
1. Click "Refresh" in Cursor's MCP settings
2. The tool will automatically attempt to resolve the conflict

## Updating the MCP Tool

To get the latest version of the CodingBaby-Browser-MCP:
1. Go to Cursor → Settings → MCP
2. Click the "Refresh" button
3. The tool will automatically pull and install the latest version

## Testing Your Setup

Once everything is installed, ask Claude 3.7 in Cursor to perform a simple browser task, such as:

"Use the CodingBaby-Browser-MCP to open Google's homepage"

If successful, you'll see your Chrome browser automatically open Google's homepage.

## Available Tools

The following browser control tools are available:

- `navigate`: Go to any URL
- `click`: Click at specific coordinates on the page
- `type`: Enter text into forms
- `press_key`: Simulate keyboard actions
- `scroll`: Scroll in any direction
- `area_screenshot`: Capture specific areas of the screen
- `wait`: Pause for a specified duration
- `batch`: Execute multiple operations in sequence
- `set_viewport`: Change browser window size
- `tab_new`: Open new browser tabs
- `tab_list`: List all open tabs
- `tab_select`: Switch between tabs
- `tab_close`: Close one tab 
- `close`: Close all tabs

## Support and Resources

For more information, updates, and documentation, please visit our official website:
[www.codingbaby.fun](https://www.codingbaby.fun)