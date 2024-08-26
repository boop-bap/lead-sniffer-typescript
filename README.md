
# Description
A joke manager monorepo based on clean architecture principles and RESTful API conventions. It consists of two main applications: API and BlazorApp. The project is designed to ensure a clear separation of concerns, maintainability, and scalability.

# Current functionality
Adding and deleting jokes, and saving them in an SQL database using a UI.

# Project Structure
## API

- **Controllers**: Contains the API controllers that handle HTTP requests and responses.
- **Entities**: Defines the core business entities used throughout the application.
- **Interfaces**: Contains the interfaces for the services and repositories, promoting dependency inversion.
- **Services**: Implements the business logic and operations.
- **Repositories**: Handles data access and storage operations.
- **Program.cs**: The entry point of the API application.
- **build_output**: Directory for build artifacts.

## BlazorApp

- **Pages**: Contains the Razor pages for the Blazor application.
- **Components**: Reusable UI components for the Blazor application.
- **Models**: Defines the data models used in the Blazor application.
- **wwwroot**: Static files such as CSS, JavaScript, and images.
- **Program.cs**: The entry point of the Blazor application.
- **build_output**: Directory for build artifacts.
  

# GitHub Actions(exploring devops)
The project includes a GitHub Actions workflow that automates the process of splitting branches for deployment as separate projects in to API and BlazorApp branches.

# Debugging with VSCode
The project is set up with a debugger configuration in Visual Studio Code, allowing to easily debug both the API and BlazorApp applications.

# There will be a shared folder if needed
