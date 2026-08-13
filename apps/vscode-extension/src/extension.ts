import * as vscode from "vscode";
import { ExtensionRuntime } from "./runtime.js";
import { SidebarProvider } from "./sidebar.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("easy-llm-code"), executable = () => vscode.workspace.getConfiguration("easyLlmCode").get<string>("executable", "easy-llm-code");
  let provider: SidebarProvider;
  const runtime = new ExtensionRuntime(executable, (snapshot) => provider?.publishSnapshot(snapshot), (event) => provider?.publishEvent(event), (message) => { if (message) output.appendLine(message); });
  provider = new SidebarProvider(context.extensionUri, runtime, output, async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) throw new Error("Open a folder before starting easy-llm-code."); await runtime.start(folder.uri.fsPath);
  });
  context.subscriptions.push(output, provider, vscode.window.registerWebviewViewProvider("easyLlmCode.chat", provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("easyLlmCode.open", () => vscode.commands.executeCommand("workbench.view.extension.easyLlmCode")),
    vscode.commands.registerCommand("easyLlmCode.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("easyLlmCode.setupProvider", () => { const terminal = vscode.window.createTerminal("easy-llm-code setup"); terminal.show(); terminal.sendText(`${shellQuote(executable())} setup`); }),
    vscode.commands.registerCommand("easyLlmCode.unlockProvider", async () => { const password = await vscode.window.showInputBox({ title: "Unlock easy-llm LLM vault", prompt: "The password is used only for this runtime session and is not stored.", password: true, ignoreFocusOut: true }); if (password === undefined) return; const folder = vscode.workspace.workspaceFolders?.[0]; if (!folder) return; await runtime.start(folder.uri.fsPath, password); }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.restart()),
  );
}

const shellQuote = (value: string): string => process.platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", `'\\''`)}'`;
export function deactivate(): void {}
