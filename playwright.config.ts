import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/ui',fullyParallel:false,workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4173',channel:'msedge',headless:true},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1050}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'node --import tsx scripts/dev.ts',url:'http://127.0.0.1:4173',timeout:30000,reuseExistingServer:false},
});
