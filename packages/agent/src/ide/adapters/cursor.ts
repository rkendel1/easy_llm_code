import { ideCapabilities } from "../capabilities.js";
import { CommandIDEAdapter } from "./command-adapter.js";
export class CursorIDEAdapter extends CommandIDEAdapter { readonly id = "cursor"; readonly name = "Cursor"; readonly command = "cursor"; readonly applicationPaths = ["/Applications/Cursor.app"]; readonly capabilities = ideCapabilities({ openFile: true, revealFile: true }); }
