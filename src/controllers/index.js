import { InternalError } from '../errors'

const controllers = {
  'global': require('./global'),
  'user': require('./user'),
}

export async function invoke(controller, action, ctx={}) {
  if(!controllers.hasOwnProperty(controller)) {
    throw new InternalError('Invalid controller')
  }
  if(typeof controllers[controller][action] !== 'function') {
    throw new InternalError('Invalid action')
  }
  return await controllers[controller][action](ctx)
}
