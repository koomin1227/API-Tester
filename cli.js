#!/usr/bin/env node
const { program } = require('commander');
const path = require('path');
const {runTest} = require("./main");

program
    .name('api-tester')
    .description('Simple CLI to test APIs from a YAML file')
    .argument('<file>', 'Path to the YAML file')
    .option('-d, --debug', 'Enable debug mode')
    .option('-p, --print', 'Print All Result')
    .action((file, options) => {
        const resolvedPath = path.resolve(file);
        console.log(`입력한 파일 경로: ${resolvedPath}`);
        runTest(resolvedPath, options);
    });

program.parse();