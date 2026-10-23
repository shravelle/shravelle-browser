// Angular integration: provide ShravelleErrorHandler so errors caught by Angular
// (which never reach window.onerror) are reported.
//
//   providers: [{ provide: ErrorHandler, useClass: ShravelleErrorHandler }]
//
// Router navigation is captured automatically through the history API.
import { ErrorHandler, Injectable } from "@angular/core";
import Shravelle from "./shravelle-browser.js";

@Injectable()
export class ShravelleErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    Shravelle.error(error);
    console.error(error);
  }
}
