import { Logger } from '@repo/logger';

/**
 * Global Error Handler Middleware
 *
 * Express'te 4 parametreli middleware "error handler" olarak tanınır.
 * Route handler'larda `next(err)` çağrıldığında veya yakalanmamış bir
 * hata fırlatıldığında buraya düşer.
 *
 * Ne yapar:
 * - Hatayı loglar (pino ile yapılandırılmış loglama)
 * - İstemciye temiz bir hata yanıtı döner
 * - Production'da stack trace göstermez (güvenlik)
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
    // Mongoose validation hatası (ör: zorunlu alan eksik)
    if (err.name === 'ValidationError') {
        return res.status(422).json({
            error: 'ValidationError',
            message: err.message
        });
    }

    // MongoDB duplicate key hatası (ör: aynı email ile kayıt)
    if (err.code === 11000) {
        return res.status(409).json({
            error: 'DuplicateKey',
            message: 'A record with this value already exists'
        });
    }

    // Beklenmeyen hatalar
    const status = err.status || err.statusCode || 500;
    Logger.error('Unhandled error', {
        method: req.method,
        url: req.originalUrl,
        status,
        error: err.message,
        stack: err.stack
    });

    res.status(status).json({
        error: 'InternalServerError',
        message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message
    });
}
