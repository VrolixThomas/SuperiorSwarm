import { getMainWindow } from "../main-window";
import { BrowserGuestRuntime } from "./guest-runtime";
import { setBrowserService } from "./handle";

export const browserRuntime = new BrowserGuestRuntime(getMainWindow);
export const workspaceBrowser = browserRuntime.service;
setBrowserService(workspaceBrowser);
