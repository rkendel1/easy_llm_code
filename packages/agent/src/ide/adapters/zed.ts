import { ideCapabilities } from "../capabilities.js";
import { CommandIDEAdapter } from "./command-adapter.js";
export class ZedIDEAdapter extends CommandIDEAdapter { readonly id = "zed"; readonly name = "Zed"; readonly command = "zed"; readonly applicationPaths = ["/Applications/Zed.app"]; readonly capabilities = ideCapabilities({ openFile: true, revealFile: true }); }
