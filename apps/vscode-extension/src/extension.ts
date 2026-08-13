import * as vscode from "vscode";
import { dirname } from "node:path";
import { ExtensionRuntime } from "./runtime.js";
import { SidebarProvider } from "./sidebar.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("easy-llm-code"), executable = () => vscode.workspace.getConfiguration("easyLlmCode").get<string>("executable", "easy-llm-code");
  let provider: SidebarProvider;
  const runtime = new ExtensionRuntime(executable, (snapshot) => provider?.publishSnapshot(snapshot), (event) => provider?.publishEvent(event), (message) => { if (message) output.appendLine(message); });
  provider = new SidebarProvider(context.extensionUri, runtime, output, async () => {
    const root = selectedProjectStart(); if (!root) throw new Error("Open a project folder or source file before starting easy-llm-code."); await runtime.start(root);
    if (!runtime.current().status?.project.indexed) {
      const choice = await vscode.window.showInformationMessage("This project has not been indexed. Index it now so easy-llm-code can answer with repository context?", "Index Project", "Not Now");
      if (choice === "Index Project") await runtime.indexProject();
    }
  });
  context.subscriptions.push(output, provider, vscode.window.registerWebviewViewProvider("easyLlmCode.chat", provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("easyLlmCode.open", () => vscode.commands.executeCommand("workbench.view.extension.easyLlmCode")),
    vscode.commands.registerCommand("easyLlmCode.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("easyLlmCode.setupProvider", () => { const terminal = vscode.window.createTerminal("easy-llm-code setup"); terminal.show(); terminal.sendText(`${shellQuote(executable())} setup`); }),
    vscode.commands.registerCommand("easyLlmCode.unlockProvider", async () => { const password = await vscode.window.showInputBox({ title: "Unlock easy-llm LLM vault", prompt: "The password is used only for this runtime session and is not stored.", password: true, ignoreFocusOut: true }); if (password === undefined) return; const root = selectedProjectStart(); if (!root) return; await runtime.start(root, password); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.restart()),
  );
}

const shellQuote = (value: string): string => process.platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", `'\\''`)}'`;
const selectedProjectStart = (): string | undefined => { const active = vscode.window.activeTextEditor?.document.uri; if (active?.scheme === "file") return vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? dirname(active.fsPath); return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; };
export function deactivate(): void {}
