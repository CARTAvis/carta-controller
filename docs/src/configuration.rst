.. _configuration:

Configuration
=============

.. _config-system:

System Configuration
--------------------

.. _config-backend:

CARTA backend permissions
~~~~~~~~~~~~~~~~~~~~~~~~~

The user under which the CARTA controller is running (assumed to be ``carta``) must be given permission to use ``sudo`` to start ``carta_backend`` processes as any authenticated user and stop running ``carta_backend`` processes belonging to authenticated users. We provide a `kill script <_static/scripts/carta_kill_script.sh>`_ which is only able to kill processes matching the name ``carta_backend``. This makes it possible to restrict what processes the ``carta`` user is permitted to kill:

.. literalinclude:: _static/scripts/carta_kill_script.sh
   :language: shell

To provide the ``carta`` user with these privileges, you must make modifications to the `sudoers configuration <https://www.sudo.ws/man/1.9.0/sudoers.man.html>`_. An `example sudoers config <_static/config/example_sudoers_conf.stub>`_ is provided. This example allows the ``carta`` user to run ``carta_backend`` only as users belonging to a specific group (assumed to be ``carta-users``), in order to deny access to unauthorized accounts:

.. literalinclude:: _static/config/example_sudoers_conf.stub
   :language: cfg

.. warning::
    Please only edit your sudoers configuration with ``visudo`` or equivalent.
    
.. _config-authentication:

Authentication
~~~~~~~~~~~~~~

When configured to use LDAP authentication, the controller signs and validates refresh and access tokens with SSL keys. You can generate a private/public key pair in PEM format using ``openssl``:

.. code-block:: shell

    openssl genrsa -out carta_private.pem 4096
    openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem
    
.. _config-nginx:

Nginx
~~~~~
    
We strongly suggest serving over HTTPS and redirecting HTTP traffic to HTTPS, especially if handling authentication internally. If you use `nginx <https://www.nginx.com/>`_ as a proxy, you can use `this configuration example <_static/config/example_nginx.conf.stub>`_ as a starting point to redirect incoming traffic from port 443 to port 8000:

.. literalinclude:: _static/config/example_nginx.conf.stub
   :language: nginx
   :emphasize-lines: 7-15
   :name: example_nginx

You can also use other HTTP servers, such as Apache. Please ensure that they are set up to forward both standard HTTP requests and WebSocket traffic to the correct port.

.. _config-dirs:

Directories
~~~~~~~~~~~

By default, the controller attempts to write log files to the ``/var/log/carta`` directory. Please ensure that this directory exists and that the ``carta`` user has write permission.

.. _config-controller:

Controller Configuration
------------------------

Controller configuration is handled by a configuration file in JSON format, adhering to the :ref:`CARTA configuration schema<schema>`. An `example configuration file <_static/config/example_config.json>`_ is provided:

.. literalinclude:: _static/config/example_config.json
   :language: json
   :name: example_config

By default, the controller assumes the config file is located at ``/etc/carta/config.json``, but you can change this with the ``--config`` or ``-c`` command line argument when running the controller.

The controller automatically executes the backend with the ``--no_http`` flag, to suppress the backend's built-in HTTP server. If the ``logFileTemplate`` configuration option is set, ``--no_log`` is also used to suppress user-level logs. ``--port`` is used to override the default port. ``--top_level_folder`` and a positional argument are used to set the top-level and starting data directories for the user, as specified in the ``rootFolderTemplate`` and ``baseFolderTemplate`` options, respectively. Additional backend flags may be specified with ``additionalArgs``.

For external authentication systems, you may need to translate a unique ID (such as email or username) from the authenticated user information to the system user. You can do this by providing a `user lookup table <_static/config/usertable.txt.stub>`_, which is watched by the controller and reloaded whenever it is updated:

.. literalinclude:: _static/config/usertable.txt.stub
   :language: cfg

You can alter the controller's dashboard appearance by adjusting the ``dashboard`` field in the config file. You can change the banner image and background, and add login instructions or institutional notices.
