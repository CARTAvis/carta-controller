.. _introduction:

Introduction
============

The CARTA controller provides a simple dashboard which authenticates users and allows them to manage their CARTA backend processes. It also serves static frontend code to clients, and dynamically redirects authenticated client connections to the appropriate backend processes. The controller can either handle authentication itself, or delegate it to an external OAuth2-based authentication server.

.. _dependencies:

Dependencies
------------

To allow the controller to serve CARTA sessions, you must give it access to an executable CARTA backend, which can be either a compiled executable or a container. If you want to use a non-standard version of the CARTA frontend, you must also build it, and adjust the controller configuration to point to it.

By default, the controller runs on port 8000. It should be run behind a proxy, so that it can be accessed via HTTP and HTTPS. 

MongoDB is required for storing user preferences, layouts, workspaces, and (in the near future) controller metrics.

You also need a working `NodeJS LTS <https://nodejs.org/en/about/releases/>`_ installation with NPM. Use ``npm install`` to install all Node dependencies.

Detailed installation instructions are available for :ref:`Ubuntu<focal_instructions>` and :ref:`RPM-based distributions<almalinux8_instructions>`.

.. _authentication:

Authentication support
----------------------

The CARTA controller supports five modes for authentication. All four modes use refresh and access tokens, as described in the `OAuth2 Authorization flow <https://tools.ietf.org/html/rfc6749#section-1.3.1>`_, stored in `JWT <https://jwt.io/>`_ format. The modes are:

* **PAM authentication**: The PAM interface of the host system is used for user authentication. After the user's username and password configuration are validated by PAM, ``carta-controller`` returns a long-lived refresh token, signed with a private key, which can be exchanged by the CARTA dashboard or the CARTA frontend client for a short-lived access token.
* **LDAP authentication**: As above, but an LDAP server is used directly for user authentication.
* **Google authentication**: Google is used at time of login. You must create a new web application in the `Google API console <https://console.developers.google.com/apis/credentials>`_. You will then use the client ID created during the configuration.  You will also need to add a callback URI to your application - e.g. if your application is installed at "https://example.com", you'd want to specify "https://example.com/api/auth/googleCallback" as an authorized redirect URI.
* **OIDC authentication**: An OIDC-compatible identity provider is used, such as keycloak.
* **External authentication**: This allows users to authenticate with some external OAuth2-based authentication system. This requires a fair amount of configuration, and has not been well-tested. It is assumed that the refresh token passed by the authentication system is stored as an ``HttpOnly`` cookie.

.. _getting_help:

Getting help
------------

If you encounter a problem with the controller or documentation, please submit an issue in the controller repo. If you need assistance in configuration or deployment, please contact the `CARTA helpdesk <mailto:carta_helpdesk@asiaa.sinica.edu.tw>`_.

.. _future_work:

Future work
-----------

Features still to be implemented:

* Better error feedback
* More flexibility with external auth
