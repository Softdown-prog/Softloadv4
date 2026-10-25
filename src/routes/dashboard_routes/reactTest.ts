'use strict';
interface ReactTestResponse { render(view: string): unknown }
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
const express = (require('express') as { Router(): { get(path: string, handler: (req: unknown, res: ReactTestResponse) => unknown): unknown } });
const router = express.Router();
const { exigirLogin } = (require('../../middlewares/authGuard') as { exigirLogin: unknown });

router.get('/react-test', (req: unknown, res: ReactTestResponse) => {
    res.render('pages/react-test');
});

module.exports = router;

export {};
