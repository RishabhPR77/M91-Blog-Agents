// The login page: the admin ID + password form when the engine says so (always when hosted), the single password
// form otherwise; wrong credentials show the engine's message; a right pair goes on to the page asked for.
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import Login from '../src/pages/Login'
import { mockFetch, renderApp } from './helpers'

const page = (route = '/login') => renderApp(<Routes><Route path="/login" element={<Login />} /><Route path="/roadmap" element={<p>roadmap page</p>} /><Route path="/" element={<p>home page</p>} /></Routes>, { route })

describe('Login', () => {
  it('admin mode: asks for the admin ID and the password, and sends both', async () => {
    const calls = mockFetch({ 'GET /api/health': { body: { ok: true, login: 'admin' } }, 'POST /api/login': { body: { ok: true } } })
    page('/login?next=%2Froadmap')
    const id = await screen.findByLabelText('Admin ID')
    expect(id).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await userEvent.type(id, 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByText('roadmap page')
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: '/api/login', body: { username: 'admin', password: 'correct horse battery staple' } }])
  })

  it('password mode: only the password, as before', async () => {
    const calls = mockFetch({ 'GET /api/health': { body: { ok: true, login: 'password' } }, 'POST /api/login': { body: { ok: true } } })
    page()
    await screen.findByLabelText('Password')
    expect(screen.queryByLabelText('Admin ID')).toBeNull()
    await userEvent.type(screen.getByLabelText('Password'), 'fake-dashboard-pass')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByText('home page')
    expect(calls.filter((c) => c.method === 'POST')[0].body).toEqual({ password: 'fake-dashboard-pass' })
  })

  it('a wrong ID or password shows the engine\'s one message and stays on the page', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, login: 'admin' } },
      'POST /api/login': { status: 401, body: { error: { code: 'bad_credentials', message: 'wrong ID or password' } } }
    })
    page()
    await userEvent.type(await screen.findByLabelText('Admin ID'), 'nobody')
    await userEvent.type(screen.getByLabelText('Password'), 'not the password')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('wrong ID or password')
    expect(screen.queryByText('home page')).toBeNull()
  })

  it('too many attempts: the engine\'s message is shown', async () => {
    mockFetch({
      'GET /api/health': { body: { ok: true, login: 'admin' } },
      'POST /api/login': { status: 429, body: { error: { code: 'too_many_attempts', message: 'too many login attempts; wait a minute' } } }
    })
    page()
    await userEvent.type(await screen.findByLabelText('Admin ID'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever password')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too many login attempts; wait a minute'))
  })
})
