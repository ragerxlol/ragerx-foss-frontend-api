import { coin } from '../../constants'
import { InternalError, UserError } from '../../errors'
import { pool } from '../../database'

import * as auth from './auth'

import { getUsers, getUserStats } from '../../stats'
import * as users from '../../stats/users'
import * as pages from '../../stats/pages'

import { validate } from 'cryptonote-address-validator'

export async function stats(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  const user = await auth.authorizeToken(ctx.jwt)

  if(!user) {
    throw new UserError('ERR_INVALID_TOKEN')
  }

  return getUserStats(user.uid)
}

export async function login(ctx) {
  if(ctx.method !== 'POST') {
    throw new InternalError('Method must be POST')
  }
  const username = ctx.body.username ?? ''
  const password = ctx.body.password ?? ''

  const user = await auth.authorizePassword(username, password)

  if(!user) {
    throw new UserError('ERR_INVALID_PASSWORD')
  }

  const data = getUserStats(user.uid)
  const token = await auth.generateToken(user)

  return [ data, token ]
}

export async function register(ctx) {
  if(ctx.method !== 'POST') {
    throw new InternalError('Method must be POST')
  }
  const username = ctx.body.username ?? ''
  const password = ctx.body.password ?? ''
  const wallet = ctx.body.wallet ?? ''

  const u = username.toLowerCase()
  if(u.startsWith('admin') || u.startsWith('guest') || u.startsWith('anon')) {
    throw new UserError('ERR_RESERVED_USERNAME')
  }
  if(!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){2,38}$/i.test(username)) {
    throw new UserError('ERR_INVALID_USERNAME')
  }
  if(password.length < 8) {
    throw new UserError('ERR_PASSWORD_TOO_SHORT')
  }

  const username_taken = await users.getUserByUsername(username)
  if(username_taken !== false) {
    throw new UserError('ERR_USERNAME_TAKEN')
  }

  if(validate(wallet, coin.address_prefixes).valid === false) {
    throw new UserError('ERR_INVALID_WALLET')
  }

  const password_hash = await auth.hashPassword(username, password)

  // salt & user_hash are used for block reports (not yet implemented)
  const salt = await auth.generateSalt()
  if(salt === false) {
    throw new InternalError('Error generating user salt')
  }

  const user_hash = auth.generateUserHash(username, salt)
  if(user_hash === false) {
    throw new InternalError('Error generating user hash')
  }

  // Insert user into database
  const params = [username, password_hash, wallet, salt, user_hash]
  const result = await pool.query('INSERT INTO users (username, password, wallet, salt, user_hash) VALUES($1, $2, $3, $4, $5) RETURNING *', params)

  const user = result.rows[0]

  // Refresh the users map in mem_cache
  await getUsers()

  const data = getUserStats(user.uid)
  const token = await auth.generateToken(user)

  return [ data, token ]
}

export async function settings(ctx) {
  if(ctx.method !== 'POST') {
    throw new InternalError('Method must be POST')
  }
  const user = await auth.authorizeToken(ctx.jwt)

  if(!user) {
    throw new UserError('ERR_INVALID_TOKEN')
  }

  const settings = ctx.body
  const sanitized = {}

  for(const [key, value] of Object.entries(settings)) {
    switch(key) {
    case 'new_password':
      sanitized.password = await auth.hashPassword(user.username, value)
      break
    case 'wallet':
      if(validate(value, coin.address_prefixes).valid === false) {
        throw new UserError('ERR_INVALID_WALLET')
      }
      sanitized[key] = value
      break
    case 'anon_leader':
      sanitized[key] = value ? true : false
      break
    case 'user_diff':
    case 'payment_threshold':
      const value_int = parseInt(value)
      if(isNaN(value_int) || value != value_int) {
        throw new UserError('ERR_INVALID_' + key.toUpperCase())
      }
      sanitized[key] = value
      break
    }
  }

  const keys = Object.keys(sanitized)
  const values = Object.values(sanitized)

  const query = ['UPDATE users SET']
  const cols = []

  for(let i = 0; i < keys.length; i++) {
    cols.push(keys[i] + ' = $' + (i + 2))
  }

  query.push(cols.join(', '), 'WHERE uid = $1 RETURNING wallet, anon_leader, user_diff, payment_threshold')

  const result = await pool.query(query.join(' '), [user.uid, ...values])

  // Refresh the users map in mem_cache
  await getUsers()

  return {
    ...result.rows[0],
    payment_threshold: parseInt(result.rows[0].payment_threshold) || 0
  }
}

export async function credits_debits(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  const user = await auth.authorizeToken(ctx.jwt)

  if(!user) {
    throw new UserError('ERR_INVALID_TOKEN')
  }

  const page = ctx.query.page ?? 1
  return await pages.getCreditsDebits(page - 1, user.uid)
}

export async function graphs(ctx) {
  if(ctx.method !== 'GET') {
    throw new InternalError('Method must be GET')
  }
  const user = await auth.authorizeToken(ctx.jwt)

  if(!user) {
    throw new UserError('ERR_INVALID_TOKEN')
  }

  const type = ctx.query.type ?? 'user_hashrate_graph'
  const length = ctx.query.resolution ?? '24h'
  return await pages.getHashrateGraph(type, length, user.uid)
}
