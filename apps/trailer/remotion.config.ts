import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setVideoImageFormat("jpeg");
Config.setConcurrency(4);
Config.setChromiumOpenGlRenderer("egl");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((current) => enableTailwind(current));
