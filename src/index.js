import { general } from './constants'
import logger from './logger'

import * as database from './database'
import * as http from './http'
import * as stats from './stats'

import fs from 'fs'
import { setIntervalAsync } from 'set-interval-async/dynamic'

const pid = process.pid
const pid_file = general.pidfile

if(fs.existsSync(pid_file)) {
  logger.log('error', 'core', 'api is already running, exiting')
  process.exit()
}

fs.writeFileSync(pid_file, pid)

logger.log('info', 'core', 'Starting api, node version: %s, pid: %d', [process.version, pid])

process.on('SIGINT', exit_gracefully)
process.on('SIGTERM', exit_gracefully)

process.on('unhandledRejection', (reason, p) => {
  logger.log('error', 'core', 'Unhandled Rejection at Promise %s', [p])
  logger.log('error', 'core', reason)
  exit_gracefully()
})

process.on('uncaughtException', err => {
  logger.log('error', 'core', 'Uncaught Exception thrown %s', [err])
  exit_gracefully()
})

function exit_gracefully() {
  logger.log('info', 'core', 'Stopping APID')
  if(fs.existsSync(pid_file)) {
    fs.unlinkSync(pid_file)
  }
  process.exit()
}

// Keep track of the last time we ran the main loop
let last_run = 0

// The main loop, should run about every 30 seconds, but will not overlap
async function loop() {

  const now = Math.floor(Date.now() / 1000)
  const now_ms = Date.now()

  // Interval runs every 1 second, but we only want to collect stats every 30s
  if(Math.floor(now / 30) === Math.floor(last_run / 30)) {
    return
  }

  logger.log('info', 'stats', 'Collecting stats...')

  try {

    // These actions run every 30s
    await stats.run30s()

    // These actions run every 1 minute
    if(Math.floor(now / 60) !== Math.floor(last_run / 60)) {
      logger.log('info', 'stats', 'Collecting 1 min stats...')
      await stats.run1m()
    }

    // These actions run every 5 minutes
    if(Math.floor(now / 300) !== Math.floor(last_run / 300)) {
      logger.log('info', 'stats', 'Collecting 5 min stats...')
      await stats.run5m()
    }

    // These actions run every hour
    if(Math.floor(now / 3600) !== Math.floor(last_run / 3600)) {
      logger.log('info', 'stats', 'Collecting 1 hour stats...')
      await stats.run1hr()
    }

    // Arbitrary actions at the end of each interval
    await stats.runAfter()

    logger.log('info', 'stats', 'Finished collecting stats... Took %d ms', [Date.now() - now_ms])

  } catch(error) {
    logger.log('error', 'stats', 'Error collecting stats...')
    logger.log('error', 'stats', error)
  }

  last_run = now
}

(async () => {
  try {
    await database.init()
    await http.init()
    await loop()
    setIntervalAsync(loop, 1000)
    logger.log('info', 'core', 'API initializated')
  } catch(error) {
    logger.log('error', 'core', 'Initialization error: %s', [error])
    exit_gracefully()
  }
})()
