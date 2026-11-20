import { mkdir,copyFile,readdir } from 'node:fs/promises';
const source=new URL('../node_modules/@fontsource/be-vietnam-pro/files/',import.meta.url);
const target=new URL('../public/fonts/',import.meta.url);
await mkdir(target,{recursive:true});
for(const name of await readdir(source))if(/^be-vietnam-pro-(latin|vietnamese)-(400|600)-normal\.woff2$/.test(name))await copyFile(new URL(name,source),new URL(name,target));
await copyFile(new URL('../node_modules/@fontsource/be-vietnam-pro/LICENSE',import.meta.url),new URL('OFL.txt',target));
console.log('Web assets ready (self-hosted Vietnamese fonts).');
