import { z } from 'zod';

export { z };

/**
 * Express middleware factory that validates request parts against Zod schemas.
 * @param {{ body?: z.ZodTypeAny, params?: z.ZodTypeAny, query?: z.ZodTypeAny }} schemas
 */
export function validate(schemas) {
    return (req, res, next) => {
        try {
            if (schemas.body) req.body = schemas.body.parse(req.body);
            if (schemas.params) req.params = schemas.params.parse(req.params);
            if (schemas.query) req.query = schemas.query.parse(req.query);
            next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                return res.status(422).json({ error: 'ValidationError', issues: err.issues });
            }
            next(err);
        }
    };
}
