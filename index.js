#!/usr/bin/env node

/* eslint-disable no-console */
// @ts-check

const findUp = require('find-up');
const fs = require('fs');
const ignore = require('ignore');
const intersection = require('lodash.intersection');
const padEnd = require('lodash.padend');
const path = require('path');
const program = require('commander');
const { walkStream } = require('@nodelib/fs.walk');
const { execSync } = require('child_process');

const Codeowners = require('./codeowners.js');

const rootPath = process.cwd();

const gitignorePath = findUp.sync('.gitignore', { cwd: rootPath });
const gitignoreMatcher = ignore();

if (gitignorePath) {
  gitignoreMatcher.add(fs.readFileSync(gitignorePath).toString());
}

program
  .command('audit')
  .description('list the owners for all files')
  .option('-u, --unowned', 'unowned files only')
  .option('-w, --width <columns>', 'how much should filenames be padded?', '32')
  .option(
    '-c, --codeowners-filename <codeowners_filename>',
    'specify CODEOWNERS filename',
    'CODEOWNERS'
  )
  .action((options) => {
    let codeowners;

    try {
      codeowners = new Codeowners(rootPath, options.codeownersFilename);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }

    const report = {};
    const padding = parseInt(options.width, 10);

    // TODO: walkStream reads untracked git files which should be excluded
    // const stream = walkStream(rootPath, {
    //   deepFilter: (entry) => {
    //     const split = entry.path.split(path.sep);
    //     const relative = path
    //       .relative(codeowners.codeownersDirectory, entry.path)
    //       .replace(/(\r)/g, '\\r');
    //     return (
    //       !split.includes('node_modules') &&
    //       !split.includes('.git') &&
    //       !gitignoreMatcher.ignores(relative)
    //     );
    //   },
    //   errorFilter: (error) =>
    //     error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM',
    // });

    const stream = require('stream');
    const readable = new stream.Readable();

    // readable.pipe(process.stdout);

    const trackedFileList = execSync('git ls-files', { encoding: 'utf-8' })
      .split('\n')
      .filter((f) => f !== '');
    trackedFileList.forEach((item) => readable.push(item));

    // no more data
    readable.push(null);

    readable.on('data', (buffer) => {
      const file = buffer.toString();
      const relative = path.relative(codeowners.codeownersDirectory, file).replace(/(\r)/g, '\\r');

      let stats;
      try {
        stats = fs.statSync(relative);
      } catch {
        // Can't read path, skip
        return;
      }

      if (gitignoreMatcher.ignores(relative) || stats.isDirectory()) {
        return;
      }

      const owners = codeowners.getOwner(relative);

      report[relative] = owners;
      return;
      if (options.unowned) {
        if (!owners.length) {
          console.log(relative);
        }
      } else {
        console.log(
          `${padEnd(relative, padding)}    ${owners.length ? owners.join(' ') : 'nobody'}`
        );
      }
    });

    readable.on('error', (err) => {
      console.error(err);
    });
    readable.on('end', () => {
      // console.log(JSON.stringify(report));
      const totalFiles = Object.keys(report).length;
      const totalFilesOwned = Object.entries(report).filter(([, value]) => value.length).length;

      // JSON
      console.log(
        JSON.stringify({
          total_files: totalFiles,
          total_files_owned: totalFilesOwned,
          ownership_coverage: ((totalFilesOwned / totalFiles) * 100).toFixed(2),
        })
      );

      // CSV
      // console.log(
      //   `${totalFiles}, ${totalFilesOwned}, ${((totalFilesOwned / totalFiles) * 100).toFixed(2)}`
      // );
    });
  });

program
  .command('verify <path> <users...>')
  .description('verify users/teams own a specific path')
  .option(
    '-c, --codeowners-filename <codeowners_filename>',
    'specify CODEOWNERS filename',
    'CODEOWNERS'
  )
  .action((checkPath, users, options) => {
    let codeowners;

    // instantiate new Codeowners obj
    try {
      codeowners = new Codeowners(rootPath, options.codeownersFilename);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }

    // call getOwner() on `path`
    const owners = codeowners.getOwner(checkPath);

    // check if any `users` are in the results of getOwner()
    const verifiedOwners = intersection(users, owners);

    // if verifiedOwners is empty, exit with error
    if (verifiedOwners.length < 1) {
      console.log(`None of the users/teams specified own the path ${checkPath}`);
      process.exit(1);
    }

    // print owners
    for (const currOwner of verifiedOwners) {
      console.log(`${checkPath}    ${currOwner}`);
    }
  });

if (!process.argv.slice(2).length) {
  program.outputHelp();
}

program.parse(process.argv);
