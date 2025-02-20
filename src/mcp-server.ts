import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { deepResearch, writeFinalReport } from "./deep-research.js";

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Helper function to log to stderr
const log = (...args: any[]) => {
  process.stderr.write(args.map(arg => 
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ') + '\n');
};

// Log environment variables for debugging (excluding sensitive values)
log('Environment check:', {
  hasOpenAiKey: !!process.env.OPENAI_API_KEY,
  hasFirecrawlKey: !!process.env.FIRECRAWL_API_KEY
});

const server = new McpServer({
  name: "deep-research",
  version: "1.0.0"
});

// Define the deep research tool
server.tool(
  "deep-research",
  "Perform deep research on a topic using AI-powered web search",
  {
    query: z.string().min(1).describe("The research query to investigate"),
    depth: z.number().min(1).max(5).describe("How deep to go in the research tree (1-5)"),
    breadth: z.number().min(1).max(5).describe("How broad to make each research level (1-5)"),
    existingLearnings: z.array(z.string()).optional().describe("Optional array of existing research findings to build upon")
  },
  async ({ query, depth, breadth, existingLearnings = [] }) => {
    try {
      log("Starting research with query:", query);
      log("Parameters:", { depth, breadth, existingLearningsCount: existingLearnings.length });

      // Track research progress
      let currentProgress = "";
      
      const result = await deepResearch({
        query,
        depth,
        breadth,
        learnings: existingLearnings,
        onProgress: (progress) => {
          const progressMsg = `Depth ${progress.currentDepth}/${progress.totalDepth}, Query ${progress.completedQueries}/${progress.totalQueries}: ${progress.currentQuery || ""}`;
          if (progressMsg !== currentProgress) {
            currentProgress = progressMsg;
            log(progressMsg);

            // Send progress notification with the text message
            server.server.notification({
              method: "notifications/progress",
              params: {
                progressToken: 0,
                data: progressMsg
              }
            }).catch(error => {
              log("Error sending progress notification:", error);
            });
          }
        }
      });

      log("Research completed, generating report...");

      // Send final progress update
      server.server.notification({
        method: "notifications/progress",
        params: {
          progressToken: 0,
          data: "Research completed, generating report..."
        }
      }).catch(error => {
        log("Error sending final progress notification:", error);
      });

      // Generate final report
      const report = await writeFinalReport({
        prompt: query,
        learnings: result.learnings,
        visitedUrls: result.visitedUrls
      });

      log("Report generated successfully");

      return {
        content: [
          { 
            type: "text", 
            text: report 
          }
        ],
        metadata: {
          learnings: result.learnings,
          visitedUrls: result.visitedUrls,
          stats: {
            totalLearnings: result.learnings.length,
            totalSources: result.visitedUrls.length
          }
        }
      };
    } catch (error) {
      log("Error in deep research:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("Error message:", errorMessage);
      
      return {
        content: [
          {
            type: "text",
            text: `Error performing research: ${errorMessage}`
          }
        ],
        isError: true
      };
    }
  }
);

async function main() {
  try {
    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("Deep Research MCP Server running on stdio");
  } catch (error) {
    log("Error starting server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  log("Fatal error in main():", error);
  process.exit(1);
}); 