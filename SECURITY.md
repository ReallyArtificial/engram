# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

The Engram team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security vulnerability, please use one of the following methods:

### 1. GitHub Security Advisories (Preferred)

Report security vulnerabilities through GitHub's Security Advisory feature:
1. Go to https://github.com/reallyartificial/engram/security/advisories
2. Click "New draft security advisory"
3. Fill in the details of your finding

### 2. Email

Send an email to [harsh.joshi.pth@gmail.com](mailto:harsh.joshi.pth@gmail.com) with:
- Type of issue (e.g., memory leak, data exposure, injection, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Response Time**: You should receive a response within 48 hours.
- **Acknowledgment**: If the issue is confirmed, we will acknowledge it and work on a fix.
- **Updates**: We will keep you informed about the progress.
- **Disclosure**: We will coordinate with you on the disclosure timeline.

### Security Update Process

1. The security report is received and assigned to a primary handler
2. The problem is confirmed and a list of affected versions is determined
3. Code is audited to find any similar problems
4. Fixes are prepared for all supported releases
5. An advisory is published

## Security Best Practices for Users

When using Engram in your projects:

1. **Keep Dependencies Updated**
   ```bash
   npm update engram
   npm audit fix
   ```

2. **Data Protection**
   - Never store sensitive credentials in memory stores
   - Use encryption for sensitive data at rest
   - Implement proper access controls

3. **Environment Variables**
   - Never hardcode sensitive information
   - Use environment variables for sensitive data
   - Keep `.env` files out of version control

4. **Memory Isolation**
   - Use separate memory namespaces for different contexts
   - Implement proper data lifecycle management
   - Clear sensitive data when no longer needed

## Security Features

Engram includes several security considerations:

- **Data Isolation**: Namespace-based memory separation
- **Input Validation**: All inputs are validated before storage
- **No Eval**: No dynamic code execution via eval()

## Third-Party Dependencies

We regularly update our dependencies to include the latest security patches. You can check the current dependencies status:

```bash
npm audit
```

## Contact

For any security-related questions that don't require reporting a vulnerability, please open a discussion in our GitHub repository.

Thank you for helping keep Engram and its users safe!
