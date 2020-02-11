import { general } from './constants'

import dateFormat from 'dateformat'
import fs from 'fs'
import { format } from 'util'

class Logger {

  constructor() {
    this.path = null
    this.stream = null
    this.setLogFile(general.logfile)
    this.openLogFile()
  }

  setLogFile(path) {
    this.path = path
  }

  openLogFile() {
    if(this.stream) {
      this.stream.end()
    }
    this.stream = fs.createWriteStream(this.path, {flags:'a'})
  }

  log(level, type, message, params=[], ctx=null) {
    const timestamp = dateFormat(new Date(), 'yyyy-mm-dd HH:MM:ss.l')
    message = format(message, ...params)

    if(ctx) {
      message = `${timestamp} [${type}] [${ctx.ip}] [${ctx.controller}/${ctx.action}] [${ctx.method}] ${message}`
    } else {
      message = `${timestamp} [${type}] ${message}`
    }

    if(this.stream) {
      this.stream.write(message+'\n')
    }

    const color_reset = '\x1b[0m'
    let color = color_reset
    switch(level) {
    case 'error':
      color = '\x1b[31m'
      break
    case 'success':
      color = '\x1b[32m'
      break
    case 'warn':
      color = '\x1b[33m'
      break
    case 'info':
      color = '\x1b[34m'
      break
    }

    console.log(color+message+color_reset)
  }

}

const instance = new Logger()

process.on('SIGHUP', () => {
  instance.openLogFile()
})

export default instance
