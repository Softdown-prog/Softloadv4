import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import Landing from './pages/Landing';
import PublicLayout from './layouts/PublicLayout';
import DashboardLayout from './layouts/DashboardLayout';
import DashboardHome from './pages/DashboardHome';
import Workspace from './pages/Workspace';
import WorkspaceChat from './pages/WorkspaceChat';
import Solaris from './pages/Solaris';
import Configuracoes from './pages/Configuracoes';
import Chat from './pages/Chat';
import Historico from './pages/Historico';
import Upgrade from './pages/Upgrade';
import Preview from './pages/Preview';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Recover from './pages/auth/Recover';
import AdminLayout from './layouts/AdminLayout';
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsuarios from './pages/admin/Usuarios';
import AdminSol from './pages/admin/Sol';
import AdminAnalytics from './pages/admin/Analytics';

function App(): React.JSX.Element {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<PublicLayout />}>
                    <Route path="/" element={<Landing />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/recover" element={<Recover />} />
                </Route>
                <Route path="/eu" element={<AdminLayout />}>
                    <Route index element={<AdminDashboard />} />
                    <Route path="usuarios" element={<AdminUsuarios />} />
                    <Route path="sol" element={<AdminSol />} />
                    <Route path="analytics" element={<AdminAnalytics />} />
                </Route>
                <Route path="/dashboard" element={<DashboardLayout />}>
                    <Route index element={<DashboardHome />} />
                    <Route path="workspace" element={<Workspace />} />
                    <Route path="workspace/chat" element={<WorkspaceChat />} />
                    <Route path="solaris" element={<Solaris />} />
                    <Route path="configuracoes" element={<Configuracoes />} />
                    <Route path="chat" element={<Chat />} />
                    <Route path="historico" element={<Historico />} />
                    <Route path="upgrade" element={<Upgrade />} />
                    <Route path="preview/session" element={<Preview />} />
                    <Route path="preview/:id" element={<Preview />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
