// An example Parse.js Backbone application based on the message app by
// [Jérôme Gravel-Niquet](http://jgn.me/). This demo uses Parse to persist
// the message items and provide user authentication and sessions.

$(function() {
  Parse.$ = jQuery;

  // Initialize Parse with your Parse application javascript keys
  Parse.initialize(creds.appID,
    creds.jsKey);

  // Message Model
  // ----------

  // Our basic Message model has `content`, `order`, and `done` attributes.
  var Message = Parse.Object.extend("Message", {
    // Default attributes for the message.
    defaults: {
      content: "empty message...",
      done: false
    },

      // Ensure that each message created has `content`.
      initialize: function() {
        if (!this.get("content")) {
          this.set({"content": this.defaults.content});
        }
      },

  });

  // This is the transient application state, not persisted on Parse
  var AppState = Parse.Object.extend("AppState", {
    defaults: {
      filter: "all"
    }
  });

  // Message Collection
  // ---------------

  var MessageList = Parse.Collection.extend({

    // Reference to this collection's model.
    model: Message,

      // Filter down the list of all message items that are finished.
      done: function() {
        return this.filter(function(message){ return message.get('done'); });
      },

      // Filter down the list to only message items that are still not finished.
      remaining: function() {
        return this.without.apply(this, this.done());
      },

      // We keep the Messages in sequential order, despite being saved by unordered
      // GUID in the database. This generates the next order number for new items.
      nextOrder: function() {
        if (!this.length) return 1;
        return this.last().get('order') + 1;
      },

      // Messages are sorted by their original insertion order.
      comparator: function(message) {
        return message.get('order');
      }

  });

  // Message Item View
  // --------------

  // The DOM element for a message item...
  var MessageView = Parse.View.extend({

    //... is a list tag.
    tagName:  "li",

      // Cache the template function for a single item.
      template: _.template($('#item-template').html()),

      // The DOM events specific to an item.
      events: {
      "dblclick label.message-content" : "edit",
      "click .message-destroy"   : "clear",
      "keypress .edit"      : "updateOnEnter",
      "blur .edit"          : "close"
      },

      // The MessageView listens for changes to its model, re-rendering. Since there's
      // a one-to-one correspondence between a Message and a MessageView in this
      // app, we set a direct reference on the model for convenience.
      initialize: function() {
        _.bindAll(this, 'render', 'close', 'remove');
        this.model.bind('change', this.render);
        this.model.bind('destroy', this.remove);
      },

      // Re-render the contents of the message item.
      render: function() {
        $(this.el).html(this.template(this.model.toJSON()));
        this.input = this.$('.edit');
        return this;
      },

      // Switch this view into `"editing"` mode, displaying the input field.
      edit: function() {
        var imgURL = this.model.attributes.image._url;

        $(this.el).prepend("<img id='ephemeral-image' src='" + imgURL + "' />");
        setTimeout(this.clear.bind(this), 15000);
      },

      // Close the `"editing"` mode, saving changes to the message.
      close: function() {
        this.model.save({content: this.input.val()});
        $(this.el).removeClass("editing");
      },

      // If you hit `enter`, we're through editing the item.
      updateOnEnter: function(e) {
        if (e.keyCode == 13) this.close();
      },

      // Remove the item, destroy the model.
      clear: function() {
        this.model.destroy();
      }

  });

  // The Application
  // ---------------

  // The main view that lets a user manage their message items
  var ManageMessagesView = Parse.View.extend({

    // Our template for the line of statistics at the bottom of the app.
    statsTemplate: _.template($('#stats-template').html()),

      // Delegated events for creating new items, and clearing completed ones.
      events: {
      "keypress #new-message":  "createOnEnter",
      "keypress #new-message-recipient": "createOnEnter",
      "click #clear-completed": "clearCompleted",
      "click .log-out": "logOut",
      "click ul#filters a": "selectFilter"
      },

      el: ".content",

      // At initialization we bind to the relevant events on the `Messages`
      // collection, when items are added or changed. Kick things off by
      // loading any preexisting messages that might be saved to Parse.
      initialize: function() {
        var self = this;

        _.bindAll(this, 'addOne', 'addAll', 'addSome', 'render', 'logOut', 'createOnEnter');

        // Main message management template
        this.$el.html(_.template($("#manage-messages-template").html()));

        this.input = this.$("#new-message");
        this.recipient = this.$("#new-message-recipient");

        // Create our collection of Messages
        this.messages = new MessageList;

        // Setup the query for the collection to look for messages from the current user
        this.messages.query = new Parse.Query(Message);
        this.messages.query.equalTo("recipient", Parse.User.current().getUsername());

        this.messages.bind('add',     this.addOne);
        this.messages.bind('reset',   this.addAll);
        this.messages.bind('all',     this.render);

        // Fetch all the message items for this user
        this.messages.fetch();

        this.displayImage();

        state.on("change", this.filter, this);
      },

      // Logs out the user and shows the login view
      logOut: function(e) {
        Parse.User.logOut();
        new LogInView();
        this.undelegateEvents();
        delete this;
      },

      // Re-rendering the App just means refreshing the statistics -- the rest
      // of the app doesn't change.
      render: function() {
        var done = this.messages.done().length;
        var remaining = this.messages.remaining().length;

        this.$('#message-stats').html(this.statsTemplate({
          total:      this.messages.length,
          done:       done,
          remaining:  remaining
        }));

        this.delegateEvents();
      },

      // Filters the list based on which type of filter is selected
      selectFilter: function(e) {
        var el = $(e.target);
        var filterValue = el.attr("id");
        state.set({filter: filterValue});
        Parse.history.navigate(filterValue);
      },

      filter: function() {
        var filterValue = state.get("filter");
        this.$("ul#filters a").removeClass("selected");
        this.$("ul#filters a#" + filterValue).addClass("selected");
        if (filterValue === "all") {
          this.addAll();
        } else if (filterValue === "completed") {
          this.addSome(function(item) { return item.get('done') });
        } else {
          this.addSome(function(item) { return !item.get('done') });
        }
      },

      // Resets the filters to display all messages
      resetFilters: function() {
        this.$("ul#filters a").removeClass("selected");
        this.$("ul#filters a#all").addClass("selected");
        this.addAll();
      },

      resetImage: function () {
        $("#unsent-image").remove();
        $("#upload-image-button-container").show();
      },

      displayImage: function () {
        $("#upload-image-button").change(function () {
          if (this.files && this.files[0]) {
            var reader = new FileReader();
            reader.onload = imageIsLoaded;
            reader.readAsDataURL(this.files[0]);
            $("#upload-image-button-container").hide();
          }
        });

        function imageIsLoaded(e) {
          $('header#header').prepend('<img id="unsent-image" src="" />');
          $('#unsent-image').attr('src', e.target.result);
        };

      },

      // Add a single message item to the list by creating a view for it, and
      // appending its element to the `<ul>`.
      addOne: function(message) {
        var view = new MessageView({model: message});
        this.$("#message-list").append(view.render().el);
      },

      // Add all items in the Messages collection at once.
      addAll: function(collection, filter) {
        this.$("#message-list").html("");
        this.messages.each(this.addOne);
      },

      // Only adds some messages, based on a filtering function that is passed in
      addSome: function(filter) {
        var self = this;
        this.$("#message-list").html("");
        this.messages.chain().filter(filter).each(function(item) { self.addOne(item) });
      },

      // If you hit return in the main input field, create new Message model
      createOnEnter: function(e) {
        var self = this;
        if (e.keyCode != 13) return;
        var message = this.input.val();
        var user;
        var recipient = this.recipient.val();
        var fileUploadControl = $("#upload-image-button")[0];
        if (fileUploadControl.files.length > 0) {
          var file = fileUploadControl.files[0];
          var name = "image.png";
          var parseFile = new Parse.File(name, file);
          parseFile.save().then(function () {
            saveMessage(message, user, parseFile);
          },
          function (error) {
            console.log(error);
          });
        }

        function saveMessage (message, user, image) {
          var msg = new Message();
          msg.set("content", message);
          msg.set("image", image);
          msg.set("order", self.messages.nextOrder());
          msg.set("recipient", recipient);
          
          msg.save();
        };

        this.input.val('');
        this.recipient.val('');
        this.resetImage();
        this.resetFilters();

      },

      // Clear all done message items, destroying their models.
      clearCompleted: function() {
        _.each(this.messages.done(), function(message){ message.destroy(); });
        return false;
      },

  });

  var LogInView = Parse.View.extend({
    events: {
      "submit form.login-form": "logIn",
      "submit form.signup-form": "signUp"
    },

      el: ".content",

      initialize: function() {
        _.bindAll(this, "logIn", "signUp");
        this.render();
      },

      logIn: function(e) {
        var self = this;
        var username = this.$("#login-username").val();
        var password = this.$("#login-password").val();

        Parse.User.logIn(username, password, {
          success: function(user) {
            new ManageMessagesView();
            self.undelegateEvents();
            delete self;
          },

          error: function(user, error) {
            self.$(".login-form .error").html("Invalid username or password. Please try again.").show();
            self.$(".login-form button").removeAttr("disabled");
          }
        });

        this.$(".login-form button").attr("disabled", "disabled");

        return false;
      },

      signUp: function(e) {
        var self = this;
        var username = this.$("#signup-username").val();
        var password = this.$("#signup-password").val();

        Parse.User.signUp(username, password, { ACL: new Parse.ACL() }, {
          success: function(user) {
            new ManageMessagesView();
            self.undelegateEvents();
            delete self;
          },

          error: function(user, error) {
            self.$(".signup-form .error").html(_.escape(error.message)).show();
            self.$(".signup-form button").removeAttr("disabled");
          }
        });

        this.$(".signup-form button").attr("disabled", "disabled");

        return false;
      },

      render: function() {
        this.$el.html(_.template($("#login-template").html()));
        this.delegateEvents();
      }
  });

  // The main view for the app
  var AppView = Parse.View.extend({
    // Instead of generating a new element, bind to the existing skeleton of
    // the App already present in the HTML.
    el: $("#messageapp"),

      initialize: function() {
        this.render();
      },

      render: function() {
        if (Parse.User.current()) {
          new ManageMessagesView();
        } else {
          new LogInView();
        }
      }
  });

  var AppRouter = Parse.Router.extend({
    routes: {
      "all": "all",
      "active": "active",
      "completed": "completed"
    },

      initialize: function(options) {
      },

      all: function() {
        state.set({ filter: "all" });
      },

      active: function() {
        state.set({ filter: "active" });
      },

      completed: function() {
        state.set({ filter: "completed" });
      }
  });

  var state = new AppState;

  new AppRouter;
  new AppView;
  Parse.history.start();
});
