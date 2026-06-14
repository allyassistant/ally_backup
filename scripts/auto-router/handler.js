/**
 * Auto Router Hook
 * 
 * Runs router.py on every incoming message to determine if sub-agent spawning is needed.
 * Stores the decision to .router-decision.json for the main agent to read.
 */

import { createSubsystemLogger } from "../../subsystem-CDcEQtQK.js";
import { resolveAgentWorkspaceDir, Ct as resolveAgentWorkspaceDir2 } from "../../query-expansion-DnS6CGY2.js";
import { c as resolveStateDir } from "../../paths-BwJ6yG6k.js";
import { isMessagePreprocessedEvent, isMessageReceivedEvent } from "../../frontmatter-D6-ANhh_.js";
import { t as resolveHookConfig } from "../../config-BYkzFD4a.js";
import { U as resolveAgentIdFromSessionKey } from "../../workspace-Cg3kGb1y.js";
import { createDefaultDeps } from "../../agent-BeieZAG2.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

//#region src/hooks/workspace/auto-router/handler.ts

const log = createSubsystemLogger("hooks/auto-router");

const ROUTER_SCRIPT = "router.py";
const DECISION_FILE = ".router-decision.json";
const STATS_FILE = ".router-stats.json";

/**
 * Get the workspace directory from event context
 */
function getWorkspaceDir(event) {
    const context = event.context || {};
    const cfg = context.cfg;
    
    if (cfg) {
        try {
            const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
            return resolveAgentWorkspaceDir2(cfg, agentId);
        } catch (e) {
            log.debug("Could not resolve workspace from cfg", { error: String(e) });
        }
    }
    
    // Fallback to default workspace
    return path.join(resolveStateDir(process.env, os.homedir()), "workspace");
}

/**
 * Find router.py in common locations
 */
async function findRouterScript(workspaceDir) {
    const possiblePaths = [
        path.join(workspaceDir, "scripts", ROUTER_SCRIPT),
        path.join(workspaceDir, "router.py"),
        path.join(os.homedir(), ".openclaw", "workspace", "scripts", ROUTER_SCRIPT),
    ];
    
    for (const p of possiblePaths) {
        try {
            await fs.access(p);
            return p;
        } catch {
            continue;
        }
    }
    
    return null;
}

/**
 * Run router.py and get the decision
 */
function runRouter(message) {
    return new Promise((resolve, reject) => {
        // Find router.py
        const workspaceDir = process.env.HOME 
            ? path.join(process.env.HOME, ".openclaw", "workspace")
            : path.join(os.homedir(), ".openclaw", "workspace");
        
        const routerPath = path.join(workspaceDir, "scripts", ROUTER_SCRIPT);
        
        const child = spawn("python3", [routerPath, message], {
            cwd: workspaceDir,
            env: { ...process.env },
        });
        
        let stdout = "";
        let stderr = "";
        
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        
        child.on("close", (code) => {
            if (code !== 0) {
                log.warn("router.py exited with non-zero code", { code, stderr });
                reject(new Error(`router.py exited with code ${code}: ${stderr}`));
                return;
            }
            
            try {
                const result = JSON.parse(stdout.trim());
                resolve(result);
            } catch (e) {
                reject(new Error(`Failed to parse router.py output: ${stdout}`));
            }
        });
        
        child.on("error", (err) => {
            reject(err);
        });
    });
}

/**
 * Save the routing decision to a file
 */
async function saveDecision(workspaceDir, decision, message) {
    const decisionPath = path.join(workspaceDir, DECISION_FILE);
    
    const data = {
        ...decision,
        timestamp: Date.now(),
        message: message,
    };
    
    await fs.writeFile(decisionPath, JSON.stringify(data, null, 2), "utf-8");
    log.debug("Saved routing decision", { path: decisionPath, decision: decision.decision });
}

/**
 * Update router stats after each decision
 */
async function updateRouterStats(workspaceDir, decision) {
    const statsPath = path.join(workspaceDir, STATS_FILE);
    
    try {
        // Read existing stats
        let stats = { spawnCount: 0, selfCount: 0, lastReset: new Date().toISOString() };
        try {
            const content = await fs.readFile(statsPath, "utf-8");
            stats = JSON.parse(content);
        } catch (e) {
            // File doesn't exist or is invalid, start fresh
            log.debug("No existing stats file, starting fresh");
        }
        
        // Increment appropriate counter
        if (decision.decision === "spawn") {
            stats.spawnCount = (stats.spawnCount || 0) + 1;
        } else if (decision.decision === "self") {
            stats.selfCount = (stats.selfCount || 0) + 1;
        }
        
        // Write updated stats
        await fs.writeFile(statsPath, JSON.stringify(stats, null, 2), "utf-8");
        log.debug("Updated router stats", { path: statsPath, spawnCount: stats.spawnCount, selfCount: stats.selfCount });
    } catch (err) {
        log.warn("Failed to update router stats", { error: err.message });
    }
}

/**
 * Main hook handler
 */
const autoRouter = async (event) => {
    // Check if this is a message event
    const isMessageEvent = isMessagePreprocessedEvent(event) || isMessageReceivedEvent(event);
    if (!isMessageEvent) {
        log.debug("Not a message event, skipping", { type: event.type, action: event.action });
        return;
    }
    
    // Get message content from context
    const context = event.context || {};
    const content = context.bodyForAgent || context.content || context.body || "";
    
    if (!content || !content.trim()) {
        log.debug("Empty message content, skipping");
        return;
    }
    
    log.debug("Processing message for routing", { 
        content: content.substring(0, 100),
        length: content.length 
    });
    
    try {
        // Find router script
        const workspaceDir = getWorkspaceDir(event);
        const routerPath = await findRouterScript(workspaceDir);
        
        if (!routerPath) {
            log.warn("router.py not found, skipping routing");
            return;
        }
        
        log.debug("Found router script", { path: routerPath });
        
        // Run router
        const decision = await runRouter(content);
        
        log.info("Routing decision", { 
            decision: decision.decision, 
            agentLabel: decision.agentLabel,
            complexity: decision.complexity 
        });
        
        // Save decision to file
        await saveDecision(workspaceDir, decision, content);
        
        // Update router stats
        await updateRouterStats(workspaceDir, decision);
        
        // If spawn is needed, push a message to notify the main agent
        if (decision.decision === "spawn" && decision.agentLabel) {
            const spawnMessage = `[ROUTER: spawn ${decision.agentLabel} agent - ${decision.reason || decision.complexity}]`;
            event.messages.push(spawnMessage);
            log.debug("Pushed spawn notification to event.messages");
        }
        
    } catch (err) {
        log.error("Failed to run router", { 
            error: err.message,
            stack: err.stack 
        });
    }
};

//#endregion

export { autoRouter as default };
