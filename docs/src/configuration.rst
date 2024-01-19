.. _configuration:

Configuration
=============

.. _config-system:

System Configuration
--------------------

.. _config-backend-permissions:

CARTA backend permissions
~~~~~~~~~~~~~~~~~~~~~~~~~

The user under which the CARTA controller is running (assumed to be ``carta``) must be given permission to use ``sudo`` to start ``carta_backend`` processes as any authenticated user and stop running ``carta_backend`` processes belonging to authenticated users. We provide a `kill script <_static/scripts/carta_kill_script.sh>`_ which is only able to kill processes matching the name ``carta_backend``. This makes it possible to restrict what processes the ``carta`` user is permitted to kill:

.. literalinclude:: _static/scripts/carta_kill_script.sh
   :language: shell

To provide the ``carta`` user with these privileges, you must make modifications to the `sudoers configuration <https://www.sudo.ws/man/1.9.0/sudoers.man.html>`_. An `example sudoers config <_static/config/example_sudoers_conf.stub>`_ is provided. This example allows the ``carta`` user to run ``carta_backend`` only as users belonging to a specific group (assumed to be ``carta-users``), in order to deny access to unauthorized accounts:

.. literalinclude:: _static/config/example_sudoers_conf.stub
   :language: cfg
   :name: example_sudoers

.. warning::
    Please only edit your sudoers configuration with ``visudo`` or equivalent.

.. note::
    Older versions of ``sudo`` do not support the ``--preserve-env=VARIABLE`` argument. If your version of ``sudo`` is too old, set ``"preserveEnv"`` to ``false`` in your controller configuration, and add ``Defaults env_keep += "CARTA_AUTH_TOKEN"`` to your sudoers configuration.

.. _config-authentication:

Authentication
~~~~~~~~~~~~~~

The controller signs and validates tokens with SSL keys. You can generate a private/public key pair in PEM format using ``openssl``:

.. code-block:: shell

    cd /etc/carta
    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem

A public/private keypair is used to authenticate access tokens. OIDC authentication requires an additional symmetric encryption key for refresh tokens. LDAP or PAM authentication uses the same public/private keypair both for access tokens and for refresh tokens. If you use the default encryption algorithm, you can again use `openssl` to generate the needed key:

.. code-block:: shell

    openssl rand -base64 32 > /etc/carta/symm.key

PAM may be configured to use the host's local UNIX user authentication, or to communicate with a local or remote LDAP server. If the UNIX module is used for authentication, the ``carta`` user must be given read-only access to ``/etc/shadow``.  This is not required if you use PAM's LDAP module or the direct LDAP authentication method.

.. _config-nginx:

Nginx
~~~~~
    
We strongly suggest serving over HTTPS and redirecting HTTP traffic to HTTPS, especially if handling authentication internally. If you use `nginx <https://www.nginx.com/>`_ as a proxy, you can use `this configuration example <_static/config/example_nginx.conf.stub>`_ as a starting point to redirect incoming traffic from port 443 to port 8000:

.. literalinclude:: _static/config/example_nginx.conf.stub
   :language: nginx
   :emphasize-lines: 7-15
   :name: example_nginx

Please ensure that you include a trailing ``/`` when hosting the controller on a subdirectory (e.g. ``location /carta/``).

You can also use other HTTP servers, such as Apache. Please ensure that they are set up to forward both standard HTTP requests and WebSocket traffic to the correct port.

.. _config-dirs:

Directories
~~~~~~~~~~~

By default, the controller attempts to write log files to the ``/var/log/carta`` directory. Please ensure that this directory exists and that the ``carta`` user has write permission.

.. _config-controller:

Controller configuration
------------------------

Controller configuration is handled by a configuration file in JSONC (JSON with JavaScript style comments) format, adhering to the :ref:`CARTA controller configuration schema<schema>`. An `example controller configuration file <_static/config/example_config.json>`_ is provided:

.. literalinclude:: _static/config/example_config.json
   :language: json
   :name: example_config

By default, the controller assumes the config file is located at ``/etc/carta/config.json``, but you can change this with the ``--config`` or ``-c`` command line argument when running the controller.

Configuration may also be added in separate files in a ``config.d`` directory in the same parent directory as the specified config file. Each file in this directory must be a valid configuration file. Any files found will be processed in alphabetical order, after the main configuration file.

The controller automatically executes the backend with the ``--no_http`` flag, to suppress the backend's built-in HTTP server. If the ``logFileTemplate`` configuration option is set, ``--no_log`` is also used to suppress user-level logs. ``--port`` is used to override the default port. ``--top_level_folder`` and a positional argument are used to set the top-level and starting data directories for the user, as specified in the ``rootFolderTemplate`` and ``baseFolderTemplate`` options, respectively. 

To specify additional backend flags, we recommend editing a :ref:`global backend preferences<config-backend>` file. Most commandline arguments to the backend are also recognised as configuration options. The ``additionalArgs`` field in the controller configuration file can be used for any debug options which are not, and to disable the local or global configuration files.

If you use an external :ref:`authentication<authentication>` system, you may need to translate a unique ID (such as email or username) from the authenticated external user information to an internal system user. You can do this by providing a `user lookup table <_static/config/usertable.txt.stub>`_, which is watched by the controller and reloaded whenever it is updated:

.. literalinclude:: _static/config/usertable.txt.stub
   :language: cfg

You can alter the controller's dashboard appearance by adjusting the ``dashboard`` field in the config file. You can change the banner image and background, and add login instructions or institutional notices.

The ``httpOnly`` flag can be used to disable secure signing of authentication tokens. This should only be used during initial deployment and testing, or debugging.

The controller assumes it is running at the root directory of your subdomain by default. If you would prefer to run on a subdirectory, you will need to specify the ``dashboardAddress`` and ``apiAddress`` values (relative to your subdomain) explicitly. For example, if you are hosting CARTA at ``https://subdomain.domain.com/carta/version/v3-beta/``, you would need to include the following in your config file:

.. code-block:: json

    {
        "apiAddress": "/carta/version/v3-beta/api",
        "dashboardAddress": "/carta/version/v3-beta/dashboard"
    }

.. _config-backend:

Backend configuration
---------------------

The global configuration file for the CARTA backend is located at ``/etc/carta/backend.json``. A per-user configuration file can also be placed in each user's local CARTA preferences directory (typically ``.carta`` or ``.carta-beta`` in the user's home directory, depending on how the CARTA backend was installed). On a multi-user system, if users have write access to this location, you may wish to disable the use of per-user configuration files, to prevent users from bypassing the root directory configuration set by the controller. This must be done through the ``additionalArgs`` field in the :ref:`controller configuration<config-controller>`.

The backend configuration file must adhere to the :ref:`CARTA backend configuration schema<schema_backend>`. An `example backend configuration file <_static/config/example_backend.json>`_ is provided:

.. literalinclude:: _static/config/example_backend.json
   :language: json
   :name: example_backend
   
.. _test-config:

Testing the configuration
-------------------------

To test the configuration of the controller, you can use the built-in test feature. Run ``carta-controller --verbose --test <username>`` as the ``carta`` user (or whichever user has the :ref:`added sudoers permissions<config-backend-permissions>`). ``<username>`` should be a user in the ``carta-users`` group. The expected output looks like this:

.. code-block::

    Checking config file /etc/carta/config.json
    Adding additional config file config.d/pam.json
    No top-level folder was specified. Reverting to default location
    Testing configuration with user alice
    Password for user alice: 
    ✔ Checked PAM connection for user alice
    ✔ Verified uid (1000) for user alice
    ✔ Generated access token for user alice
    ✔ Checked database connection
    ✔ Checked log writing for user alice
    ✔ Read frontend index.html from /custom/frontend/path/build
    [
    'running sudo --preserve-env=CARTA_AUTH_TOKEN -n -u alice /usr/bin/carta_backend --no_http --debug_no_auth --port 3499 --top_level_folder /usr/share/carta --no_log /usr/share/carta'
    ]
    [2024-01-19 08:30:05.888Z] [CARTA] [info] /usr/bin/carta_backend: Version 4.1.0
    [2024-01-19 08:30:05.888Z] [CARTA] [info] Listening on port 3499 with top level folder /home/ubuntu, starting folder /home/ubuntu, and 8 OpenMP worker threads
    ✔ Backend process started successfully
    [2024-01-19 08:30:07.850Z] [CARTA] [info] 0x561f1a635180 ::Session (1235524527:1)
    [2024-01-19 08:30:07.850Z] [CARTA] [info] Session 1235524527 [127.0.0.1] Connected. Num sessions: 1
    ✔ Backend process accepted connection
    [ 'running sudo -u alice ./scripts/carta_kill_script.sh 54275' ]
    ✔ Backend process killed correctly
    Controller tests with user alice succeeded

.. note::
    If you run the controller from a source directory using ``npm``, use ``--`` to ensure that any commandline parameters are passed to the controller and not to ``npm``. For example: ``npm run start -- --verbose --test alice``.
