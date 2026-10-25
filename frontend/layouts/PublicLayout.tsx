import React from 'react';
import { Outlet } from 'react-router-dom';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import CookieConsent from '../components/CookieConsent';

export default function PublicLayout(): React.JSX.Element {
    return (
        <>
            <PublicNavbar />
            <Outlet />
            <PublicFooter />
            <CookieConsent />
        </>
    );
}
