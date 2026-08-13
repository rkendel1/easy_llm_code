import { ideCapabilities } from "../capabilities.js";
import { CommandIDEAdapter } from "./command-adapter.js";
export class VSCodeIDEAdapter extends CommandIDEAdapter { readonly id = "vscode"; readonly name = "Visual Studio Code"; readonly command = "code"; readonly applicationPaths = ["/Applications/Visual Studio Code.app"]; readonly capabilities = ideCapabilities({ openFile: true, revealFile: true }); }
