
// This defines an internal error
// Controllers should throw this if the message
// should NOT be sent to the frontend
export class InternalError extends Error {
  constructor(message = '', ...args) {
    super(message, ...args)
  }
}

// This defines a user facing error
// Controllers should throw this if the message
// should be send to the frontend and displayed
export class UserError extends Error {
  constructor(message = '', ...args) {
    super(message, ...args)
  }
}
