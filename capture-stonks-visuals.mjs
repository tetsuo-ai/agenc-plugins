/** Isolated Electron captures of the current logo, real Desktop card, and chart renderer. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { priceChartSvg } from "./plugins/stonks-copilot/server/charts.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const desktop = process.env.AGENC_DESKTOP_ROOT;
const outputRoot = process.env.STONKS_VISUAL_OUTPUT_ROOT;
assert.ok(desktop && isAbsolute(desktop), "AGENC_DESKTOP_ROOT must be absolute");
assert.ok(outputRoot && isAbsolute(outputRoot), "STONKS_VISUAL_OUTPUT_ROOT must be absolute");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { build } = requireDesktop("esbuild");
const electron = requireDesktop("electron");
const manifest = JSON.parse(await readFile(join(root, "plugins/stonks-copilot/.agenc-plugin/plugin.json"), "utf8"));
await mkdir(outputRoot, { recursive: true });
const captures = await mkdtemp(join(outputRoot, "stonks-"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "stonks-electron-"));
const profile = join(temporaryRoot, "profile");
await mkdir(profile);
const bars = Array.from({ length: 260 }, (_, index) => {
  const close = 110 + index * 0.19 + Math.sin(index / 13) * 7 + Math.cos(index / 29) * 4;
  return { date: new Date(Date.UTC(2025, 8, 5 + index)).toISOString().slice(0, 10), open: close - Math.sin(index) * 1.3, high: close + 1.8, low: close - 1.5, close, volume: 600000 + (index % 11) * 28000 };
});
const average = period => bars.map((_, index) => index < period - 1 ? null : bars.slice(index - period + 1, index + 1).reduce((sum, bar) => sum + bar.close, 0) / period);
const chart = priceChartSvg(bars, { symbol: "SYNTHETIC FIXTURE", overlays: { sma50: average(50), sma200: average(200) } });
assert.ok(chart);
const chartPath = join(captures, "synthetic-price.svg");
await writeFile(chartPath, chart);
const renderer = join(temporaryRoot, "renderer.js");
const html = join(temporaryRoot, "index.html");
const main = join(temporaryRoot, "main.cjs");
const plugin = {
  id: "stonks-copilot@agenc-plugins", name: manifest.interface.displayName,
  description: manifest.interface.shortDescription, longDescription: manifest.interface.longDescription,
  source: "agenc-plugins", scope: "public", category: "Featured", icon: "agenc",
  installed: false, enabled: false, version: manifest.version, developer: "tetsuo-ai",
  prompts: manifest.interface.defaultPrompt, logo: "agenc-media://logo", accent: manifest.interface.brandColor,
  commands: Object.entries(manifest.commands).map(([name, command]) => ({ name, description: command.description })),
};
try {
  await build({ stdin: {
    contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PluginIcon } from './src/renderer/src/components/plugins/PluginIcon.tsx';
import { PluginsPane } from './src/renderer/src/components/plugins/PluginsPane.tsx';
import './src/renderer/styles.css';
import './src/renderer/src/components/plugins/plugin-polish.css';
const plugin = ${JSON.stringify(plugin)};
const snapshot = {plugins:[plugin],skills:[],mcps:[],apps:[],marketplaces:[]};
const noop = async()=>{};
const actions = {refresh:async()=>snapshot,install:noop,uninstall:noop,update:noop,setEnabled:noop,addMarketplace:noop,removeMarketplace:noop,upgradeMarketplace:noop,setMcpEnabled:noop,saveMcp:noop,removeMcp:noop,authenticateMcp:noop};
window.agenc = {openExternal:noop, pickDirectory:async()=>null};
const root = createRoot(document.getElementById('root'));
window.renderMode = (mode, dark=false) => {
  document.documentElement.className = dark ? 'theme-dark' : '';
  flushSync(()=>root.render(mode === 'catalog'
    ? <div className="plugin-workspace-panel"><div className="plugin-workspace-scroll"><PluginsPane initialSnapshot={snapshot} actions={actions}/></div></div>
    : mode === 'chart'
      ? <section className="proof"><h1>Stonks Copilot · price chart</h1><p>Real priceChartSvg renderer · 260 synthetic bars · SMA50 / SMA200</p><img className="chart" src="agenc-media://chart"/></section>
      : <section className="proof"><h1>Stonks Copilot · logo scale check</h1><p>Actual manifest asset · real Desktop PluginIcon component</p><div className="logo-grid"><div><img className="full-logo" src="agenc-media://logo"/><p>512 × 512 source display</p></div><div className="small-logo-grid">{[32,48].map(size=><div key={size}><div className={'scale scale-'+size}><PluginIcon kind="agenc" name="Stonks Copilot" logo="agenc-media://logo"/></div><p>{size} × {size} px</p></div>)}</div></div></section>));
};
window.renderMode('logo');
`,
    resolveDir: desktop, sourcefile: "stonks-proof.jsx", loader: "jsx",
  }, bundle: true, format: "iife", platform: "browser", outfile: renderer,
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl", ".svg": "dataurl", ".png": "dataurl", ".webp": "dataurl" }, logLevel: "silent" });
  await writeFile(html, `<!doctype html><html><head><link rel="stylesheet" href="${pathToFileURL(join(temporaryRoot, "renderer.css")).href}"><style>html,body,#root{margin:0;width:100%;height:100%}body{background:var(--bg);color:var(--text);font-family:Inter,sans-serif}.proof{padding:36px}.proof h1{font-size:24px;margin:0 0 10px}.proof p{font-size:14px;opacity:.7}.logo-grid{display:grid;grid-template-columns:544px 1fr;gap:56px;margin-top:26px}.full-logo{width:512px;height:512px}.small-logo-grid{display:flex;gap:52px;align-items:center}.scale-32 .plugin-icon{width:32px;height:32px}.scale-48 .plugin-icon{width:48px;height:48px}.chart{display:block;width:960px;height:480px;margin-top:28px}.plugin-workspace-panel{padding:20px}</style></head><body><div id="root"></div><script src="${pathToFileURL(renderer).href}"></script></body></html>`);
  await writeFile(main, `
const {app,BrowserWindow,protocol,net}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');const {pathToFileURL}=require('node:url');
app.setPath('userData',process.env.STONKS_PROFILE);app.setPath('sessionData',process.env.STONKS_PROFILE);
app.commandLine.appendSwitch('disable-gpu');
protocol.registerSchemesAsPrivileged([{scheme:'agenc-media',privileges:{stream:true,supportFetchAPI:true,bypassCSP:true}}]);
app.whenReady().then(async()=>{
  const allowed={'agenc-media://logo':process.env.STONKS_LOGO,'agenc-media://chart':process.env.STONKS_CHART};
  protocol.handle('agenc-media',request=>allowed[request.url]?net.fetch(pathToFileURL(allowed[request.url]).href):new Response('blocked',{status:403}));
  const win=new BrowserWindow({width:1080,height:780,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  try{
    await win.loadFile(process.env.STONKS_HTML);
    const results=[];
    for(const [name,mode,dark] of [['logo-light','logo',false],['logo-dark','logo',true],['desktop-card','catalog',false],['price-chart','chart',false]]){
      await win.webContents.executeJavaScript('window.renderMode('+JSON.stringify(mode)+','+dark+')');
      await win.webContents.executeJavaScript('Promise.all([...document.images].map(img=>img.decode()))');
      await new Promise(resolve=>setTimeout(resolve,180));
      const metrics=await win.webContents.executeJavaScript('({images:[...document.images].map(img=>({src:img.src,loaded:img.complete&&img.naturalWidth>0,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height})),overflow:document.documentElement.scrollWidth>innerWidth})');
      if(metrics.images.some(img=>!img.loaded))throw new Error('Image failed to render');
      const image=await win.webContents.capturePage();if(image.isEmpty())throw new Error('Empty capture');
      await fs.writeFile(path.join(process.env.STONKS_CAPTURES,name+'.png'),image.toPNG());
      results.push({name,...metrics});
    }
    console.log(JSON.stringify({captures:process.env.STONKS_CAPTURES,results}));win.destroy();app.exit(0);
  }catch(error){console.error(error);win.destroy();app.exit(1);}
});
`);
  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(electron, [`--user-data-dir=${profile}`, main], {
      cwd: temporaryRoot, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, TMPDIR: temporaryRoot, AGENC_HOME: join(temporaryRoot, "agenc"), AGENC_PLUGIN_CACHE_DIR: join(temporaryRoot, "plugins"), STONKS_PROFILE: profile, STONKS_LOGO: join(root, "plugins/stonks-copilot/assets/logo.png"), STONKS_CHART: chartPath, STONKS_HTML: html, STONKS_CAPTURES: captures },
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Isolated Electron timed out: ${stderr}`)); }, 35_000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolveOutput(stdout) : reject(new Error(`Isolated Electron failed: ${stderr}`)); });
  });
  console.log(output.trim());
} finally {
  assert.equal(dirname(resolve(temporaryRoot)), resolve(tmpdir()));
  assert.ok(temporaryRoot.includes("stonks-electron-"));
  await rm(temporaryRoot, { recursive: true, force: true });
}
