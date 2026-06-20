class AppError extends Error {
  constructor(message, statusCode = 400, issues = []) {
    super(message);
    this.statusCode = statusCode;
    this.issues = issues;
    this.name = 'AppError';
  }
}

export default AppError;
