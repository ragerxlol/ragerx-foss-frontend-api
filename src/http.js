import { api } from './constants'
import logger from './logger'

import { InternalError, UserError } from './errors'
import { invoke } from './controllers'

import http from 'http'
import url from 'url'

const server = http.createServer()

server.on('request', (request, response) => {

  const parsed = url.parse(request.url, true)
  const [ controller, action ] = parsed.pathname.substring(1).split('/')

  // Build the ctx object, this is passed to the controllers
  const ctx = {
    method: request.method,
    controller, action,
    ip: request.headers['x-real-ip'] ?? request.connection.remoteAddress,
    jwt: request.headers['x-jwt-token'] ?? '',
    query: parsed.query,
    body: {},
    log: (level, type, message, params=[]) => logger.log(level, type, message, params, ctx)
  }

  const replyError = (message='Internal Server Error', code=500) => {
    response.statusCode = code
    response.setHeader('Content-Type', 'application/json')
    response.write(JSON.stringify({ error: true, message }))
    response.end()
  }

  const handle = async () => {
    try {
      const data = await invoke(controller, action, ctx)

      response.statusCode = 200
      response.setHeader('Content-Type', 'application/json')
      response.write(JSON.stringify(data))
      response.end()

    } catch(error) {
      if(error instanceof UserError) {
        replyError(error.message)
      } else {
        replyError()
      }
      ctx.log('error', 'http', '[%s] %s', [error.constructor.name, error.message])
      ctx.log('error', 'http', error)
    }
  }

  if(!controller || !action) {
    ctx.log('warn', 'http', 'Invalid controller or action')
    return replyError()
  }

  request.on('error', error => {
    ctx.log('warn', 'http', 'Encountered request on error')
    replyError()
  })

  response.on('error', error => {
    // this should never happen
    // https://stackoverflow.com/questions/53455973/does-the-http-response-stream-need-error-event-handlers-in-node-js
    ctx.log('error', 'http', 'Encountered response on error')
  })

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  response.setHeader('Access-Control-Allow-Headers', 'content-type, x-jwt-token');

  if(request.method === 'OPTIONS') {

    response.writeHead(200)
    response.end()

  } else if(request.method === 'GET') {

    handle()

  } else if(request.method === 'POST') {

    if((request.headers['content-type'] ?? '').indexOf('application/json') !== 0) {
      ctx.log('warn', 'http', 'Invalid content-type')
      return replyError()
    }

    const body = []
    request.on('data', chunk => {
      body.push(chunk)
    })

    request.on('end', async () => {
      try {
        ctx.body = JSON.parse(Buffer.concat(body).toString())
      } catch(error) {
        ctx.log('warn', 'http', 'Malformed json body')
        return replyError()
      }

      handle()
    })

  } else {
    ctx.log('warn', 'http', 'Invalid HTTP method %s', [request.method])
    return replyError()
  }
})


export function init() {
  return new Promise((resolve, reject) => {
    server.listen(api.port, api.hostname, error => {
      if(error) {
        logger.log('error', 'frontend', error);
        return reject('Failed to start api server')
      }
      logger.log('info', 'frontend', 'Started api server on %s:%d', [server.address().address, server.address().port])
      resolve()
    })
  })
}
