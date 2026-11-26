#!/usr/bin/env node
// Exact public recruiting release evidence. Public GETs only: no auth, secrets,
// application RPCs, browser installation, or source-data writes.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SITE = "https://galaxyfinancial.org";
const IMAGE_PATH = "/galaxy-recruiting-20261126.jpg";
const IMAGE_SHA256 = "2f9f804984a742ac820357424e4969e40bcb861a8547cfc363b83471b1086eec";
const IMAGE_BYTES = 68228;
const TITLE = "Galaxy Financial — Where Winning Agencies Are Built";
const read = path => readFileSync(new URL("../" + path, import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
class Unresolved extends Error {}

function invariant(condition,message){if(!condition)throw new Error(message);}

function decodeEntities(value){return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi,(_,key)=>{if(key[0]==="#"){const hex=key[1].toLowerCase()==="x";const n=parseInt(key.slice(hex?2:1),hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):"\ufffd";}return {amp:"&",quot:'"',apos:"'",lt:"<",gt:">"}[key.toLowerCase()];});}

function metadata(html){
 const clean=html.replace(/<!--[\s\S]*?-->/g,"").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"");
 const head=clean.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];invariant(typeof head==="string","HTML head is missing");
 const titles=[...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];invariant(titles.length===1,"Expected exactly one page title");
 const values=new Map(),canonicals=[];
 for(const match of head.matchAll(/<(meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
  const attrs={};for(const a of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)){const name=a[1].toLowerCase();invariant(!(name in attrs),"Duplicate HTML attribute");attrs[name]=decodeEntities(a[2]??a[3]??a[4]);}
  if(match[1].toLowerCase()==="link"&&(attrs.rel??"").toLowerCase().split(/\s+/).includes("canonical")){invariant(typeof attrs.href==="string","Canonical href is missing");canonicals.push(attrs.href);}
  if(match[1].toLowerCase()==="meta"){
   const property=attrs.property?.toLowerCase(),name=attrs.name?.toLowerCase();
   const key=property?.startsWith("og:")?"property:"+property:name?.startsWith("twitter:")||name==="description"?"name:"+name:null;
   if(key){invariant(!values.has(key),"Duplicate metadata "+key);invariant(typeof attrs.content==="string","Missing metadata content "+key);values.set(key,attrs.content);}
  }
 }
 invariant(canonicals.length===1,"Expected exactly one canonical URL");
 return {title:decodeEntities(titles[0][1]).trim(),canonical:canonicals[0],meta:Object.fromEntries([...values].sort(([a],[b])=>a.localeCompare(b)))};
}

function jpegDimensions(bytes){
 invariant(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217,"Invalid JPEG boundary markers");
 let pos=2;
 while(pos<bytes.length-1){
  invariant(bytes[pos++]===255,"Invalid JPEG segment marker");while(bytes[pos]===255)pos++;
  const marker=bytes[pos++];if(marker===0xda||marker===0xd9)break;
  const length=(bytes[pos]<<8)|bytes[pos+1];invariant(length>=2&&pos+length<=bytes.length,"Invalid JPEG segment length");
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){invariant(length>=8,"Invalid JPEG frame");return {width:(bytes[pos+5]<<8)|bytes[pos+6],height:(bytes[pos+3]<<8)|bytes[pos+4]};}
  pos+=length;
 }
 throw new Error("JPEG dimensions are missing");
}

function querySignature(params){return JSON.stringify([...params.entries()].sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv)));}

function verifyRedirectDestination(original,target){
 invariant(target.protocol==="https:","Legacy redirect downgraded HTTPS");
 invariant(["apex-financial.org","www.apex-financial.org","galaxyfinancial.org","www.galaxyfinancial.org"].includes(target.hostname),"Legacy redirect left the approved public hosts");
 invariant(target.pathname===original.pathname,"Legacy redirect changed the requested path");
 invariant(querySignature(target.searchParams)===querySignature(original.searchParams),"Legacy redirect changed the synthetic query");
}

function selftest(){
 let checks=0;const ok=(value,message)=>{invariant(value,message);checks++;};const rejects=(fn,message)=>{let rejected=false;try{fn();}catch{rejected=true;}ok(rejected,message);};
 const html='<html><head><title>Galaxy &amp; Partners</title><meta content="Galaxy &amp; Partners" property="og:title"><meta name=\'twitter:title\' content=\'Galaxy &amp; Partners\'><link href="https://galaxyfinancial.org" rel="canonical"></head></html>';
 const parsed=metadata(html);ok(parsed.title==="Galaxy & Partners","Title entity decoding");ok(parsed.meta["property:og:title"]===parsed.title,"Reordered metadata attributes");ok(parsed.meta["name:twitter:title"]===parsed.title,"Single-quoted metadata");
 ok(JSON.stringify(metadata(html.replace("<head>","<head><!-- <title>APEX</title> --><script>const x = '<title>APEX</title>';</script>")))===JSON.stringify(parsed),"Ignore script/comment tags");
 rejects(()=>metadata(html.replace("</head>","<title>Duplicate</title></head>")),"Duplicate title must fail");
 rejects(()=>metadata(html.replace("</head>",'<link rel="canonical" href="https://example.invalid"></head>')),"Duplicate canonical must fail");
 rejects(()=>metadata(html.replace("</head>",'<meta property="og:title" content="Duplicate"></head>')),"Duplicate metadata must fail");
 rejects(()=>metadata("<html></html>"),"Missing head must fail");
 const jpg=new Uint8Array([255,216,255,192,0,8,8,2,118,4,176,3,255,217]);const dimensions=jpegDimensions(jpg);
 ok(dimensions.width===1200&&dimensions.height===630,"JPEG frame dimensions");
 rejects(()=>jpegDimensions(jpg.slice(0,-1)),"Truncated JPEG must fail");
 rejects(()=>jpegDimensions(new Uint8Array([255,216,255,217])),"Missing JPEG frame must fail");
 const original={pathname:"/apply",searchParams:new Map([["ref","synthetic-release-probe"],["source","canonical-check"]])};
 const target={protocol:"https:",hostname:"galaxyfinancial.org",pathname:"/apply",searchParams:new Map([["source","canonical-check"],["ref","synthetic-release-probe"]])};
 verifyRedirectDestination(original,target);ok(true,"Preserved query in a different order");
 rejects(()=>verifyRedirectDestination(original,{...target,pathname:"/"}),"Dropped path must fail");
 rejects(()=>verifyRedirectDestination(original,{...target,searchParams:new Map([["source","canonical-check"]])}),"Dropped referral query must fail");
 rejects(()=>verifyRedirectDestination(original,{...target,protocol:"http:"}),"HTTPS downgrade must fail");
 rejects(()=>verifyRedirectDestination(original,{...target,hostname:"example.invalid"}),"External redirect must fail");
 return checks;
}

async function request(url) {
  let response;
  try {
    response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(25000),
      headers: { "Cache-Control": "no-cache" } });
  } catch (error) {
    throw new Unresolved("Public GET could not complete for " + url + ": " + error.message);
  }
  if (response.status >= 500) throw new Unresolved("Public GET returned HTTP " + response.status + " for " + url);
  return response;
}
async function bytes(response, limit) {
  const reader = response.body?.getReader();
  invariant(reader, "Response body is missing");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("Public response exceeds its bounded size"); }
      chunks.push(part.value);
    }
  } catch (error) {
    if (length > limit) throw error;
    throw new Unresolved("Public response body could not be read: " + error.message);
  }
  return Buffer.concat(chunks, length);
}
async function version(expected, stage) {
  const response = await request(SITE + "/version.json?link-proof=" + expected + "-" + stage + "-" + Date.now());
  invariant(response.status === 200, "Version endpoint returned HTTP " + response.status);
  const body = JSON.parse((await bytes(response, 4096)).toString("utf8"));
  if (body.id !== expected) throw new Unresolved("Production revision changed or did not match: expected " + expected + ", observed " + body.id);
  console.log("PUBLIC_LINK_VERSION " + JSON.stringify({ stage, expected, observed: body.id }));
}
async function image(path) {
  const response = await request(SITE + path);
  invariant(response.status === 200, path + " returned HTTP " + response.status);
  invariant(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "image/jpeg", path + " did not serve image/jpeg");
  const content = await bytes(response, 300 * 1024);
  invariant(content.length === IMAGE_BYTES, path + " has an unexpected size");
  invariant(sha256(content) === IMAGE_SHA256, path + " differs from the verified rendered JPEG");
  const dimensions = jpegDimensions(content);
  invariant(dimensions.width === 1200 && dimensions.height === 630, path + " has unexpected dimensions");
  console.log("PUBLIC_LINK_IMAGE " + JSON.stringify({ path, bytes: content.length, sha256: IMAGE_SHA256, ...dimensions }));
}
async function legacyRedirect(path) {
  const original = new URL(path, "https://apex-financial.org");
  original.search = "?ref=synthetic-release-probe&source=canonical-check";
  let current = original; const visited = new Set(); const trace = [];
  for (let hop = 0; hop < 6; hop++) {
    invariant(!visited.has(current.href), "Legacy redirect loop"); visited.add(current.href);
    const response = await request(current.href);
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      invariant(location, "Legacy redirect has no Location");
      const next = new URL(location, current);
      trace.push({ from: current.href, status: response.status, to: next.href });
      console.log("PUBLIC_LINK_REDIRECT_HOP " + JSON.stringify(trace.at(-1)));
      verifyRedirectDestination(original, next);
      current = next;
      continue;
    }
    invariant(response.status === 200, "Legacy destination returned HTTP " + response.status);
    invariant(trace.length > 0 && current.origin === SITE, "Legacy host served HTTP 200 without reaching the Galaxy origin");
    invariant(response.headers.get("content-type")?.toLowerCase().startsWith("text/html"), "Legacy destination did not serve HTML");
    verifyRedirectDestination(original, current);
    console.log("PUBLIC_LINK_REDIRECT " + JSON.stringify({ source: original.href, destination: current.href, hops: trace.length, status: response.status }));
    return;
  }
  throw new Error("Legacy redirect exceeded six hops");
}
async function main() {
  const expectedRevision = process.env.GITHUB_SHA?.slice(0, 8);
  invariant(/^[0-9a-f]{8}$/.test(expectedRevision ?? ""), "GITHUB_SHA is required for exact release attribution");
  const expected = metadata(read("index.html").toString("utf8"));
  const manifest = JSON.parse(read("scripts/data/share-card.json").toString("utf8"));
  invariant(expected.title === TITLE && expected.meta["property:og:title"] === TITLE && expected.meta["name:twitter:title"] === TITLE, "Source titles do not describe the recruiting release");
  invariant(expected.canonical === SITE && expected.meta["property:og:url"] === SITE, "Source canonical URLs are not Galaxy");
  invariant(manifest.image === "public" + IMAGE_PATH, "Source manifest points to another share card");
  invariant(manifest.svg_sha256 === sha256(read(manifest.svg)), "Source SVG does not match its render manifest");
  invariant(expected.meta["property:og:image"] === SITE + IMAGE_PATH && expected.meta["name:twitter:image"] === SITE + IMAGE_PATH, "Source social metadata points to another share card");
  invariant(!/apex/i.test(JSON.stringify(expected)), "Source public metadata still contains APEX branding");
  invariant(sha256(read(manifest.image)) === IMAGE_SHA256 && sha256(read("public/galaxy-recruit-og.jpg")) === IMAGE_SHA256, "Source image bytes differ from the verified render");
  await version(expectedRevision, "before");
  const response = await request(SITE + "/");
  invariant(response.status === 200 && response.headers.get("content-type")?.toLowerCase().startsWith("text/html"), "Homepage did not serve HTTP 200 HTML");
  const actual = metadata((await bytes(response, 1024 * 1024)).toString("utf8"));
  invariant(JSON.stringify(actual) === JSON.stringify(expected), "Served title, description, Open Graph, Twitter, or canonical metadata differs from this release");
  console.log("PUBLIC_LINK_METADATA " + JSON.stringify(actual));
  await image(IMAGE_PATH);
  await image("/galaxy-recruit-og.jpg");
  await legacyRedirect("/");
  await legacyRedirect("/apply");
  await version(expectedRevision, "after");
  console.log("PUBLIC_LINK_RELEASE_VERIFIED " + expectedRevision);
}
async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--selftest") {
    console.log("Public recruiting proof selftests passed: " + selftest());
  } else if (args.length === 1 && args[0] === "--legacy-only") {
    await legacyRedirect("/"); await legacyRedirect("/apply");
  } else {
    invariant(args.length === 0, "Unknown probe arguments"); await main();
  }
}
run().catch(error => {
  console.error("PUBLIC_LINK_RELEASE_" + (error instanceof Unresolved ? "UNRESOLVED" : "FAILED") + ": " + error.message);
  process.exitCode = error instanceof Unresolved ? 3 : 1;
});
