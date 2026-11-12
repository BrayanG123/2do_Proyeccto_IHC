import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/axios'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Al cargar la app, revisa si hay sesión guardada
  useEffect(() => {
    const token = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    if (token && savedUser) {
      setUser(JSON.parse(savedUser))
    }
    setLoading(false)
  }, [])

  const register = async (first_name, last_name, email, password, config) => {
    const res = await api.post('/auth/register', { first_name, last_name, email, password }, config)
    const { access_token, user } = res.data
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(user))
    setUser(user)
    return user
  }

  const login = async (email, password, config) => {
    const res = await api.post('/auth/login', { email, password }, config)
    const { access_token, user } = res.data
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(user))
    setUser(user)
    return user
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const forgotPassword = async (email) => {
    const res = await api.post('/auth/forgot-password', { email })
    return res.data
  }

  const resetPassword = async (email, new_password) => {
    const res = await api.post('/auth/reset-password', { email, new_password })
    return res.data
  }

  const loginWithCode = async (email, code, config) => {
    const res = await api.post('/auth/login-with-code', { email, code }, config)
    const { access_token, user } = res.data
    localStorage.setItem('token', access_token)
    localStorage.setItem('user', JSON.stringify(user))
    setUser(user)
    return user
  }

  const changePassword = async (current_password, new_password) => {
    const res = await api.post('/auth/change-password', { current_password, new_password })
    return res.data
  }

  const refreshUser = async () => {
    try {
      const res = await api.get('/auth/me')
      localStorage.setItem('user', JSON.stringify(res.data))
      setUser(res.data)
      return res.data
    } catch (e) {
      console.warn('No se pudo refrescar datos de usuario:', e)
    }
  }

  const updateProfile = async (first_name, last_name, email, config) => {
    const res = await api.put('/auth/profile', { first_name, last_name, email }, config)
    localStorage.setItem('user', JSON.stringify(res.data))
    setUser(res.data)
    return res.data
  }

  const uploadAvatar = async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await api.post('/auth/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    localStorage.setItem('user', JSON.stringify(res.data))
    setUser(res.data)
    return res.data
  }

  const removeAvatar = async () => {
    const res = await api.delete('/auth/avatar')
    localStorage.setItem('user', JSON.stringify(res.data))
    setUser(res.data)
    return res.data
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        register,
        login,
        logout,
        forgotPassword,
        resetPassword,
        loginWithCode,
        changePassword,
        refreshUser,
        updateProfile,
        uploadAvatar,
        removeAvatar,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
