# Nostr para Neófitos

Guía educativa completa en español sobre el protocolo Nostr. Una landing page estática diseñada para ayudar a nuevos usuarios a entender y empezar con Nostr en 5 minutos.

## 🎯 Características

- ✅ **Una sola página** - Todo el contenido accesible sin navegación compleja
- ✅ **Dark mode nativo** - Diseño moderno con colores neutros y fucsia de Nostr
- ✅ **100% responsive** - Funciona perfecto en móvil, tablet y desktop
- ✅ **SEO optimizado** - Meta tags, Open Graph, keywords en español
- ✅ **Sin dependencias** - HTML/CSS/JS vanilla, sin frameworks
- ✅ **Captación de leads** - Formulario newsletter integrado
- ✅ **FAQ interactivo** - Accordion para preguntas frecuentes
- ✅ **Tabs funcionales** - Para clientes por sistema operativo

## 📦 Contenido

1. **Hero** - Intro llamativa con CTAs
2. **¿Qué es Nostr?** - Explicación con analogías simples
3. **Conceptos clave** - npub/nsec con ejemplos visuales
4. **Guía paso a paso** - 4 pasos para empezar
5. **Seguridad** - Proteger el nsec (Amber, nos2x, Alby)
6. **Relays** - Explicación simple de cómo funcionan
7. **Tutorial Amber + Primal** - Paso a paso para Android
8. **Nivel intermedio** - Zaps y NIP-05
9. **Primeros pasos** - Cuentas recomendadas en español
10. **FAQ** - 9 preguntas frecuentes con accordion
11. **Recursos** - Links útiles
12. **Newsletter** - Captación de emails

## 🚀 Deploy en GitHub Pages

### Opción 1: Repositorio nuevo

```bash
# 1. Crea un nuevo repo en GitHub (ej: nostr-neofitos)

# 2. Clona el repo
git clone https://github.com/TU_USUARIO/nostr-neofitos.git
cd nostr-neofitos

# 3. Copia el index.html al repo
cp /ruta/a/index.html .

# 4. Commit y push
git add index.html
git commit -m "feat: landing page Nostr para Neófitos"
git push origin main

# 5. Activa GitHub Pages
# Ve a Settings → Pages → Source: main branch → Save
```

### 1. Meta tags (línea ~13)
```html
<meta property="og:url" content="https://tudominio.com">
<link rel="canonical" href="https://tudominio.com">
```

### 2. Lightning Address (footer)
```html
<a href="LIGHTNING_ADDRESS_AQUI" class="lightning-btn">
```
Ejemplo: `lightning:tunombre@getalby.com`

### 3. Tu perfil Nostr (footer)
```html
<a href="TU_NPUB_AQUI" target="_blank">Ver mi perfil →</a>
```
Usa `https://njump.me/npub1...` para que funcione en cualquier navegador

### 4. GitHub repo (footer)
```html
<a href="https://github.com/TU_REPO_AQUI" target="_blank">
```

### 5. Newsletter (sección newsletter)
Integra con tu servicio preferido:
- **Mailchimp**: Añade action URL del formulario
- **Substack**: Redirect a página de suscripción
- **EmailOctopus**: API key en el script
- **Simple**: Usa un servicio como Formspree

Ejemplo con Formspree:
```html
<form action="https://formspree.io/f/TU_FORM_ID" method="POST">
```

## 📊 SEO y Analytics

### Keywords objetivo (español)
- `nostr que es`
- `nostr español`
- `nostr guía`
- `como usar nostr`
- `protocolo nostr`
- `red social descentralizada`

### Google Search Console
1. Verifica propiedad del dominio
2. Envía sitemap (aunque es una sola página)
3. Monitoriza keywords y clicks

### Google Analytics (opcional)
Añade antes del `</head>`:
```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-TU_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-TU_ID');
</script>
```

## 💡 Ideas para monetización

1. **Links de afiliado**
   - Wallets Lightning (Alby, Phoenix)
   - Hardware wallets si mencionas seguridad
   - VPN si hablas de privacidad

2. **Propinas Lightning**
   - Botón prominente en hero
   - Link en cada sección útil
   - "Invítame un café" al final

3. **Servicios de consultoría**
   - Sesiones 1:1 para configurar Nostr
   - Workshops para empresas
   - Link a Calendly

4. **Productos digitales**
   - Ebook avanzado sobre Nostr
   - Curso en video
   - Newsletter premium

## 🎨 Paleta de colores

```css
--bg-primary: #0a0a0a     /* Negro profundo */
--bg-secondary: #141414   /* Gris muy oscuro */
--bg-tertiary: #1e1e1e    /* Gris oscuro */
--text-primary: #e5e5e5   /* Blanco cálido */
--text-secondary: #a0a0a0 /* Gris medio */
--accent: #c44dff         /* Fucsia Nostr */
--accent-hover: #d470ff   /* Fucsia más claro */
--border: #2a2a2a         /* Gris para bordes */
```

## 📱 Testing

### Checklist pre-launch
- [ ] Todos los links internos funcionan (#anclas)
- [ ] Links externos se abren en nueva pestaña
- [ ] Formulario newsletter procesa emails
- [ ] FAQ accordion funciona
- [ ] Tabs de clientes funcionan
- [ ] Responsive en móvil (iPhone SE, Android)
- [ ] Lightning button tiene dirección real
- [ ] Meta tags actualizados con dominio real
- [ ] Tested en Chrome, Firefox, Safari

### Lighthouse Score objetivo
- Performance: >90
- Accessibility: >95
- Best Practices: >95
- SEO: 100

## 📈 Roadmap futuro

### v1.1
- [ ] Traducción a inglés
- [ ] Modo claro opcional
- [ ] Más tutoriales (otros clientes)
- [ ] Comparador de clientes (tabla)

### v1.2
- [ ] Blog integrado (posts sobre Nostr)
- [ ] Directorio de apps Nostr en español
- [ ] Glossario interactivo

### v2.0
- [ ] App web progresiva (PWA)
- [ ] Generador de claves in-browser
- [ ] Widget de chat Nostr embebido

## 🤝 Contribuir

Este proyecto es open source. Acepto PRs para:
- Correcciones de typos
- Mejoras de copy
- Nuevos tutoriales
- Traducciones
- Optimizaciones de código

## 📄 Licencia

MIT License - Usa, modifica y comparte libremente.

## 🙏 Créditos

- Inspirado por las guías de [nostr.how](https://nostr.how/es)
- Recursos educativos de [Estudio Bitcoin](https://estudiobitcoin.com)
- Comunidad Nostr hispanohablante

---

**Hecho con 💜 para la comunidad Nostr**

*¿Dudas? Encuéntrame en Nostr → [TU_NPUB]*
